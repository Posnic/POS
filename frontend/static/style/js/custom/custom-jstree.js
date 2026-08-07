/*
----------------------------------
    : Custom - jsTree js :
----------------------------------
*/
(function() {
    "use strict";
    /* -- Basic Tree -- */
    $('#types-tree').jstree({
        'core' : {
            'themes' : {
                'responsive': false
            },
            'data' : [
                  {
                      "text" : "Soyuz",
                      "state" : {"opened" : true },
                      "icon" : "feather icon-folder",
                      "children" : [
                          {
                            "text" : "Assets",
                            "state" : { "opened" : true },
                            "icon" : "feather icon-folder",
                             "children" : [
                                  { "text" : "CSS", "state" : { "opened" : true }, "icon" : "feather icon-file" },
                                  { "text" : "JS", "icon" : "feather icon-file" },
                                  { "text" : "Fonts", "icon" : "feather icon-file" },
                                  { "text" : "Images", "icon" : "feather icon-file" },
                                  { 
                                    "text" : "Plugins",                                     
                                    "state" : { "opened" : true },
                                    "icon" : "feather icon-folder",  
                                    "children" : [
                                          { "text" : "jQuery", "icon" : "feather icon-file" },
                                          { "text" : "Bootstrap", "state" : { "selected" : true, "opened" : true }, "icon" : "feather icon-file" }
                                      ]
                                  }
                              ]
                          },
                          {
                            "text" : "Icons",
                            "icon" : "feather icon-droplet"
                          },
                          {
                            "text" : "Events",
                            "icon" : "feather icon-calendar"
                          },
                          {
                            "text" : "UI Kits",
                            "state" : { "opened" : true },
                            "icon" : "feather icon-box",
                            "children" : [
                                  { "text" : "Buttons", "icon" : "feather icon-file" },
                                  { "text" : "Badges", "icon" : "feather icon-file" }
                              ]
                          },
                          {
                            "text" : "Forms",
                            "icon" : "feather icon-file-text"
                          },
                          {
                            "text" : "Charts",
                            "icon" : "feather icon-bar-chart-line-"
                          },
                          {
                            "text" : "Pages",
                            "state" : { "opened" : true },
                            "icon" : "feather icon-book-open",
                            "children" : [
                                  { "text" : "Coming Soon", "icon" : "feather icon-file" },
                                  { "text" : "Maintenance", "icon" : "feather icon-file" }
                              ]
                          },
                          {
                            "text" : "Tables",
                            "icon" : "feather icon-server"
                          },
                      ]
                },
                {
                    "text" : "Documents",
                    "state" : { "opened" : true },
                    "icon" : "feather icon-folder"
                }
              ]
        },
        'plugins' : ['types']
    });    
    /* -- Checkbox Tree -- */
    $('#checkbox-tree').jstree({
        'core' : {
            'themes' : {
                'responsive': false
            },
            'data' : [
                  {
                      "text" : "Soyuz",
                      "state" : {"opened" : true },
                      "icon" : "feather icon-folder",
                      "children" : [
                          {
                            "text" : "Assets",
                            "state" : { "opened" : true },
                            "icon" : "feather icon-folder",
                             "children" : [
                                  { "text" : "CSS", "state" : { "opened" : true }, "icon" : "feather icon-file" },
                                  { "text" : "JS", "icon" : "feather icon-file" },
                                  { "text" : "Fonts", "icon" : "feather icon-file" },
                                  { "text" : "Images", "icon" : "feather icon-file" },
                                  { 
                                    "text" : "Plugins",                                     
                                    "state" : { "opened" : true },
                                    "icon" : "feather icon-folder",  
                                    "children" : [
                                          { "text" : "jQuery", "icon" : "feather icon-file" },
                                          { "text" : "Bootstrap", "state" : { "selected" : true, "opened" : true }, "icon" : "feather icon-file" }
                                      ]
                                  }
                              ]
                          },
                          {
                            "text" : "Icons",
                            "icon" : "feather icon-droplet"
                          },
                          {
                            "text" : "Events",
                            "icon" : "feather icon-calendar"
                          },
                          {
                            "text" : "UI Kits",
                            "state" : { "opened" : true },
                            "icon" : "feather icon-box",
                            "children" : [
                                  { "text" : "Buttons", "icon" : "feather icon-file" },
                                  { "text" : "Badges", "icon" : "feather icon-file" }
                              ]
                          },
                          {
                            "text" : "Forms",
                            "icon" : "feather icon-file-text"
                          },
                          {
                            "text" : "Charts",
                            "icon" : "feather icon-bar-chart-line-"
                          },
                          {
                            "text" : "Pages",
                            "state" : { "opened" : true },
                            "icon" : "feather icon-book-open",
                            "children" : [
                                  { "text" : "Coming Soon", "icon" : "feather icon-file" },
                                  { "text" : "Maintenance", "icon" : "feather icon-file" }
                              ]
                          },
                          {
                            "text" : "Tables",
                            "icon" : "feather icon-server"
                          },
                      ]
                },
                {
                    "text" : "Documents",
                    "state" : { "opened" : true },
                    "icon" : "feather icon-folder"
                }
              ]
        },
        'plugins' : ['types', 'checkbox']
    });    
    /* -- Drag & Drop Tree -- */
    $('#drag-drop-tree').jstree({
        'core' : {
            'themes' : {
                'responsive': false
            },
            'check_callback' : true,
            'data' : [
                  {
                      "text" : "Soyuz",
                      "state" : {"opened" : true },
                      "icon" : "feather icon-folder",
                      "children" : [
                          {
                            "text" : "Assets",
                            "state" : { "opened" : true },
                            "icon" : "feather icon-folder",
                             "children" : [
                                  { "text" : "CSS", "state" : { "opened" : true }, "icon" : "feather icon-file" },
                                  { "text" : "JS", "icon" : "feather icon-file" },
                                  { "text" : "Fonts", "icon" : "feather icon-file" },
                                  { "text" : "Images", "icon" : "feather icon-file" },
                                  { 
                                    "text" : "Plugins",                                     
                                    "state" : { "opened" : true },
                                    "icon" : "feather icon-folder",  
                                    "children" : [
                                          { "text" : "jQuery", "icon" : "feather icon-file" },
                                          { "text" : "Bootstrap", "state" : { "selected" : true, "opened" : true }, "icon" : "feather icon-file" }
                                      ]
                                  }
                              ]
                          },
                          {
                            "text" : "Icons",
                            "icon" : "feather icon-droplet"
                          },
                          {
                            "text" : "Events",
                            "icon" : "feather icon-calendar"
                          },
                          {
                            "text" : "UI Kits",
                            "state" : { "opened" : true },
                            "icon" : "feather icon-box",
                            "children" : [
                                  { "text" : "Buttons", "icon" : "feather icon-file" },
                                  { "text" : "Badges", "icon" : "feather icon-file" }
                              ]
                          },
                          {
                            "text" : "Forms",
                            "icon" : "feather icon-file-text"
                          },
                          {
                            "text" : "Charts",
                            "icon" : "feather icon-bar-chart-line-"
                          },
                          {
                            "text" : "Pages",
                            "state" : { "opened" : true },
                            "icon" : "feather icon-book-open",
                            "children" : [
                                  { "text" : "Coming Soon", "icon" : "feather icon-file" },
                                  { "text" : "Maintenance", "icon" : "feather icon-file" }
                              ]
                          },
                          {
                            "text" : "Tables",
                            "icon" : "feather icon-server"
                          },
                      ]
                },
                {
                    "text" : "Documents",
                    "state" : { "opened" : true },
                    "icon" : "feather icon-folder"
                }
              ]
        },
        'plugins' : ['dnd']
    });    
    /* -- Ajax Tree -- */
    $('#ajax-tree').jstree({
        'core' : {
            'animation' : 0,
            'check_callback' : true,
            'force_text' : true,
            'themes' : {
                'responsive': false
            },
            'data' : {
                'url' : function (node) {
                    return node.id === '#' ? './static/plugins/jstree/ajax_roots.json' : './static/plugins/jstree/ajax_children.json';
                },
                'data' : function (node) {
                    return { 'id' : node.id };
                }
            }
        },
        "types" : {
            'default' : {
                'icon' : 'feather icon-folder'
            },
            'file' : {
                'icon' : 'feather icon-file'
            }
        },
        "plugins" : [ "contextmenu", "dnd", "search", "state", "types", "wholerow" ]
    });
})();