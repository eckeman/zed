/*global define*/
define(function(require, exports, module) {
    "use strict";
    var async = require("./lib/async");
    var eventbus = require("./lib/eventbus");
    var project = require("./project");
    var editor = require("./editor");
    var state = require("./state");
    var locator = require("./lib/locator");
    var ui = require("./lib/ui");

    eventbus.declare("switchsession");
    eventbus.declare("newfilecreated");
    eventbus.declare("filedeleted");
    eventbus.declare("newsession");
    eventbus.declare("sessionbeforesave");
    eventbus.declare("sessionsaved");
    eventbus.declare("sessionchanged");
    eventbus.declare("allsessionsloaded");

    var sessions = {};
    var oldstateJSON = null;

    exports.specialDocs = {}; // {content: ..., mode: ..., readonly: true}

    function setupSave(session) {
        var saveTimer = null;
        var path = session.filename;
        session.on('change', function(delta) {
            if(session.ignoreChange)
                return;
            eventbus.emit("sessionchanged", session, delta);
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(function() {
                eventbus.emit("sessionactivitystarted", session, "Saving");
                eventbus.emit("sessionbeforesave", session);
                project.writeFile(path, session.getValue(), function(err) {
                    if(err) {
                        eventbus.emit("sessionactivityfailed", session, "Failed to save");
                    } else {
                        eventbus.emit("sessionactivitycompleted", session);
                        eventbus.emit("sessionsaved", session);
                    }
                });
            }, 1000);
        });
        sessions[path] = session;
    }

    function updateState() {
        state.set("session.current", editor.getEditors().map(function(e) {
            return e.getSession().filename;
        }));

        var openDocumentList = Object.keys(sessions);

        openDocumentList.sort(function(a, b) {
            var sessionA = sessions[a];
            var sessionB = sessions[b];
            return sessionB.lastUse - sessionA.lastUse;
        });

        var openDocuments = {};
        openDocumentList.slice(0, 25).forEach(function(path) {
            openDocuments[path] = editor.getSessionState(sessions[path]);
        });
        state.set("session.open", openDocuments);

        var stateJSON = state.toJSON();
        if (stateJSON !== oldstateJSON) {
            console.log("Saving state.");
            state.save();
        }

        oldstateJSON = stateJSON;
    }


    function loadFile(path, callback) {
        project.readFile(path, function(err, text, options) {
            if(err) {
                return callback(err);
            }
            options = options || {};
            var session = editor.createSession(path, text);
            session.readOnly = !!options.readOnly;
            setupSave(session);
            callback(null, session);
        });
    }

    function handleChangedFile(path) {
        var session = sessions[path];
        if(!session) {
            return;
        }
        project.readFile(path, function(err, text) {
            if(err) {
                return console.error("Could not load file:", path);
            }
            var cursor = session.selection.getCursor();
            session.ignoreChange = true;
            session.setValue(text);
            session.selection.moveCursorToPosition(cursor);
            session.ignoreChange = false;
        });
    }

    function go(path, edit, previousSession) {
        edit = edit || editor.getActiveEditor();
        if (!path) {
            return;
        }

        if (exports.specialDocs[path]) {
            var doc = exports.specialDocs[path];
            var session = editor.createSession(path, doc.content);
            session.readOnly = true;
            session.setMode(doc.mode);
            editor.switchSession(session, edit);
            return;
        }
        var pathParts = path.split(':');
        path = pathParts[0];
        var loc = pathParts[1];
        if (path[0] !== '/') {
            // Normalize
            path = '/' + path;
        }

        // Check if somebody is not trying to create a file ending with '/'
        if(path[path.length-1] === '/') {
            eventbus.emit("sessionactivityfailed", previousSession, "Cannot create files ending with /");
            return;
        }

        if (sessions[path]) {
            show(sessions[path]);
        } else {
            eventbus.emit("sessionactivitystarted", previousSession, "Loading...");
            loadFile(path, function(err, session) {
                eventbus.emit("sessionactivitycompleted", previousSession);
                if (err) {
                    console.log("Creating new, empty file", path);
                    session = editor.createSession(path, "");
                    setupSave(session);
                    show(session);
                    eventbus.emit("newfilecreated", path);
                    project.writeFile(path, "", function(err) {
                        if(err) {
                            eventbus.emit("sessionactivityfailed", session, "Could not create file");
                        }
                    });
                } else {
                    eventbus.emit("newsession", session);
                    show(session);
                }
            });
        }

        function show(session) {
            session.lastUse = Date.now();
            previousSession = previousSession || edit.getSession();
            if(previousSession.watcherFn) {
                project.unwatchFile(previousSession.filename, previousSession.watcherFn);
            }
            editor.switchSession(session, edit);

            if(loc) {
                setTimeout(function() {
                    locator.jump(loc);
                });
            }

            // File watching
            session.watcherFn = function(path, kind) {
                ui.unblockUI();
                if(kind === "changed") {
                    handleChangedFile(path);
                } else if(kind === "deleted") {
                    console.log("File deleted", path);
                    delete sessions[path];
                    eventbus.emit("filedeleted", path);
                } else {
                    console.log("Other kind", kind);
                    ui.blockUI("Disconnected, hang on... If this message doesn't disappear within a few seconds: close this window and restart your Zed client.");
                }
            };
            project.watchFile(session.filename, session.watcherFn);
        }
    }

    exports.hook = function() {
        async.waitForEvents(eventbus, ["stateloaded", "modesloaded"], function() {
            var sessionStates = state.get("session.open") || {};

            go("zed:start");

            async.parForEach(Object.keys(sessionStates), function(path, next) {
                var sessionState = sessionStates[path];
                loadFile(path, function(err, session) {
                    if(err) {
                        delete sessionStates[path];
                    } else {
                        editor.setSessionState(session, sessionState);
                    }
                    next();
                });
            }, function done() {
                console.log("All sessions loaded.");
                var editors = editor.getEditors();
                if(state.get("session.current")) {
                    state.get("session.current").forEach(function(path, idx) {
                        go(path, editors[idx]);
                    });
                }
                eventbus.emit("allsessionsloaded");
            });

            setInterval(updateState, 2500);
        });

        ui.blockUI("Loading project and file list. One moment please...");

        async.waitForEvents(eventbus, ["loadedfilelist", "stateloaded"], function() {
            ui.unblockUI();
        });
    };

    exports.go = go;
    exports.handleChangedFile = handleChangedFile;

    exports.getSessions = function() {
        return sessions;
    };
});
