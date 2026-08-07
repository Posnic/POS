/*
--------------------------------------------------------------
  Template Name: Soyuz - Bootstrap 4x Admin Dashboard Template
  File: Core JS File
--------------------------------------------------------------
 */
"use strict";
$(document).ready(function() {
    /* -- Menu Hamburger -- */
    $(".menu-hamburger").on("click", function(e) {
        e.preventDefault();
        $("body").toggleClass("toggle-menu");
        $(".menu-hamburger img").toggle();
    });
    /* -- Menu Topbar Hamburger -- */    
    $(".topbar-toggle-hamburger").on("click", function(e) {
        e.preventDefault();
        $("body").toggleClass("topbar-toggle-menu");
        $(".topbar-toggle-hamburger img").toggle();    
    });
    /* -- Media Size -- */
    function mediaSize() { 
        if (window.matchMedia('(max-width: 767px)').matches) {
            $("body").removeClass("toggle-menu");
            $(".menu-hamburger img.menu-hamburger-close").hide();
            $(".menu-hamburger img.menu-hamburger-collapse").show();         
        }
    };
    mediaSize();
    window.addEventListener('resize', mediaSize, false);
    /* -- Bootstrap Popover -- */
    $('[data-toggle="popover"]').popover();
    /* -- Bootstrap Tooltip -- */
    $('[data-toggle="tooltip"]').tooltip();
});