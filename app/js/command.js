/*global define ace _ chrome */
define(function(require, exports, module) {
    "use strict";
    var useragent = ace.require("ace/lib/useragent");
    var commands = {};
    
    /**
     * @param path in the form of 'Editor:Select All'
     * @param definition json object:
     *  {
     *      exec: function() { ... },
     *      readOnly: true
     *  }
     */
    exports.define = function(path, def) {
        def.name = path;
        commands[path] = def;
    };
    
    exports.lookup = function(path) {
        return commands[path];
    };
    
    exports.exec = function(path) {
        var def = exports.lookup(path);
        def.exec.apply(null, _.toArray(arguments).slice(1));
    };
    
    exports.allCommands = function() {
        return Object.keys(commands);
    };
    
    exports.define("Command:Enter Command", {
        exec: function(edit) {
            // Lazy loading these
            require(["./lib/ui", "./lib/fuzzyfind", "./editor", "./keys", "./state"], function(ui, fuzzyfind, editor, keys, state) {
                var recentCommands = state.get("recent.commands") || {};
                var commandKeys = keys.getCommandKeys();
                
                function filter(phrase) {
                    var results = fuzzyfind(exports.allCommands(), phrase);
                    results.forEach(function(result) {
                        var k = commandKeys[result.path];
                        if(k) {
                            if(_.isString(k)) {
                                result.meta = k;
                            } else {
                                result.meta = useragent.isMac ? k.mac : k.win;
                            }
                        }
                    });
                    results.sort(function(a, b) {
                        if(a.score === b.score) {
                            var lastUseA = recentCommands[a.name] || 0;
                            var lastUseB = recentCommands[b.name] || 0;
                            if(lastUseA === lastUseB) {
                                return a.name < b.name ? -1 : 1;
                            } else {
                                return lastUseB - lastUseA;
                            }
                        } else {
                            return b.score - a.score;
                        }
                    });
                    return results;
                }
                ui.filterBox({
                    placeholder: "Enter command",
                    filter: filter,
                    onSelect: function(cmd) {
                        recentCommands[cmd] = Date.now();
                        state.set("recent.commands", recentCommands);
                        exports.exec(cmd, edit);
                    }
                });
            });
        },
        readOnly: true
    });
    
    exports.define("Settings:Preferences", {
        exec: function() {
            chrome.app.window.create('editor.html?url=settings:&chromeapp=true', {
                frame: 'chrome',
                width: 720,
                height: 400,
            });
        },
        readOnly: true
    });
    
    exports.define("Settings:Toggle Highlight Active Line", {
        exec: function() {
            require(["./settings"], function(settings) {
                settings.set("highlightActiveLine", !settings.get("highlightActiveLine"));
            });
        },
        readOnly: true
    });
    
    exports.define("Settings:Toggle Highlight Gutter Line", {
        exec: function() {
            require(["./settings"], function(settings) {
                settings.set("highlightGutterLine", !settings.get("highlightGutterLine"));
            });
        },
        readOnly: true
    });
    
    exports.define("Settings:Toggle Show Print Margin", {
        exec: function() {
            require(["./settings"], function(settings) {
                settings.set("showPrintMargin", !settings.get("showPrintMargin"));
            });
        },
        readOnly: true
    });
    
    exports.define("Settings:Toggle Show Invisibles", {
        exec: function() {
            require(["./settings"], function(settings) {
                settings.set("showInvisibles", !settings.get("showInvisibles"));
            });
        },
        readOnly: true
    });
    
    exports.define("Settings:Toggle Display Indent Guides", {
        exec: function() {
            require(["./settings"], function(settings) {
                settings.set("displayIndentGuides", !settings.get("displayIndentGuides"));
            });
        },
        readOnly: true
    });
    
    exports.define("Settings:Toggle Show Gutter", {
        exec: function() {
            require(["./settings"], function(settings) {
                settings.set("showGutter", !settings.get("showGutter"));
            });
        },
        readOnly: true
    });
    
    exports.define("Editor:Reset State", {
        exec: function() {
            require(["./state"], function(state) {
                state.reset();
            });
        },
        readOnly: true
    });
});
