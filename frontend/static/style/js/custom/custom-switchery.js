/*
---------------------------------
    : Custom - Switchery js :
---------------------------------
*/
!function($) {
  "use strict";
      /* -- Switchery - Colored Switches -- */
      var primary = document.querySelector('.js-switch-primary');
      var switchery = new Switchery(primary, { color: '#506fe4' });
      var secondary = document.querySelector('.js-switch-secondary');
      var switchery = new Switchery(secondary, { color: '#96a3b6' });
      var success = document.querySelector('.js-switch-success');
      var switchery = new Switchery(success, { color: '#43d187' });
      var danger = document.querySelector('.js-switch-danger');
      var switchery = new Switchery(danger, { color: '#f9616d' });
      var warning = document.querySelector('.js-switch-warning');
      var switchery = new Switchery(warning, { color: '#f7bb4d' });      
      var info = document.querySelector('.js-switch-info');
      var switchery = new Switchery(info, { color: '#3d9bfb' });
      var light = document.querySelector('.js-switch-light');
      var switchery = new Switchery(light, { color: '#f2f3f7' });
      var dark = document.querySelector('.js-switch-dark');
      var switchery = new Switchery(dark, { color: '#141d46' });
      /* -- Switchery - Small Switches -- */
      var primary_small = document.querySelector('.js-switch-primary-small');
      var switchery = new Switchery(primary_small, { color: '#506fe4', size: 'small' });
      var secondary_small = document.querySelector('.js-switch-secondary-small');
      var switchery = new Switchery(secondary_small, { color: '#96a3b6', size: 'small' });
      var success_small = document.querySelector('.js-switch-success-small');
      var switchery = new Switchery(success_small, { color: '#43d187', size: 'small' });
      var danger_small = document.querySelector('.js-switch-danger-small');
      var switchery = new Switchery(danger_small, { color: '#f9616d', size: 'small' });
      var warning_small = document.querySelector('.js-switch-warning-small');
      var switchery = new Switchery(warning_small, { color: '#f7bb4d', size: 'small' });      
      var info_small = document.querySelector('.js-switch-info-small');
      var switchery = new Switchery(info_small, { color: '#3d9bfb', size: 'small' });
      var light_small = document.querySelector('.js-switch-light-small');
      var switchery = new Switchery(light_small, { color: '#f2f3f7', size: 'small' });
      var dark_small = document.querySelector('.js-switch-dark-small');
      var switchery = new Switchery(dark_small, { color: '#141d46', size: 'small' });
      /* -- Switchery - Large Switches -- */
      var primary_large = document.querySelector('.js-switch-primary-large');
      var switchery = new Switchery(primary_large, { color: '#506fe4', size: 'large' });
      var secondary_large = document.querySelector('.js-switch-secondary-large');
      var switchery = new Switchery(secondary_large, { color: '#96a3b6', size: 'large' });
      var success_large = document.querySelector('.js-switch-success-large');
      var switchery = new Switchery(success_large, { color: '#43d187', size: 'large' });
      var danger_large = document.querySelector('.js-switch-danger-large');
      var switchery = new Switchery(danger_large, { color: '#f9616d', size: 'large' });
      var warning_large = document.querySelector('.js-switch-warning-large');
      var switchery = new Switchery(warning_large, { color: '#f7bb4d', size: 'large' });      
      var info_large = document.querySelector('.js-switch-info-large');
      var switchery = new Switchery(info_large, { color: '#3d9bfb', size: 'large' });
      var light_large = document.querySelector('.js-switch-light-large');
      var switchery = new Switchery(light_large, { color: '#f2f3f7', size: 'large' });
      var dark_large = document.querySelector('.js-switch-dark-large');
      var switchery = new Switchery(dark_large, { color: '#141d46', size: 'large' });
      /* -- Switchery - Multicolor Switches -- */
      var primary_multicolor = document.querySelector('.js-switch-primary-multicolor');
      var switchery = new Switchery(primary_multicolor, { color: '#506fe4', jackColor: '#dbe5fd' });
      var secondary_multicolor = document.querySelector('.js-switch-secondary-multicolor');
      var switchery = new Switchery(secondary_multicolor, { color: '#96a3b6', jackColor: '#e9eaed' });
      var success_multicolor = document.querySelector('.js-switch-success-multicolor');
      var switchery = new Switchery(success_multicolor, { color: '#43d187', jackColor: '#a5ecc4' });
      var danger_multicolor = document.querySelector('.js-switch-danger-multicolor');
      var switchery = new Switchery(danger_multicolor, { color: '#f9616d', jackColor: '#ffe4e6' });
      var warning_multicolor = document.querySelector('.js-switch-warning-multicolor');
      var switchery = new Switchery(warning_multicolor, { color: '#f7bb4d', jackColor: '#fef7e6' });      
      var info_multicolor = document.querySelector('.js-switch-info-multicolor');
      var switchery = new Switchery(info_multicolor, { color: '#3d9bfb', jackColor: '#c7ecee' });
      var light_multicolor = document.querySelector('.js-switch-light-multicolor');
      var switchery = new Switchery(light_multicolor, { color: '#f2f3f7', jackColor: '#e2e6ea' });
      var dark_multicolor = document.querySelector('.js-switch-dark-multicolor');
      var switchery = new Switchery(dark_multicolor, { color: '#141d46', jackColor: '#7e7e7e' });
      /* -- Switchery - On-Off Multicolor Switches -- */
      var primary_multicolor_on_off = document.querySelector('.js-switch-primary-multicolor-on-off');
      var switchery = new Switchery(primary_multicolor_on_off, { color: '#506fe4', secondaryColor: '#949ca9', jackColor: '#dbe5fd', jackSecondaryColor: '#e9eaed' });
      var secondary_multicolor_on_off = document.querySelector('.js-switch-secondary-multicolor-on-off');
      var switchery = new Switchery(secondary_multicolor_on_off, { color: '#96a3b6', secondaryColor: '#506fe4', jackColor: '#e9eaed', jackSecondaryColor: '#dbe5fd' });
      var success_multicolor_on_off = document.querySelector('.js-switch-success-multicolor-on-off');
      var switchery = new Switchery(success_multicolor_on_off, { color: '#43d187', secondaryColor: '#f9616d', jackColor: '#a5ecc4', jackSecondaryColor: '#ffe4e6' });
      var danger_multicolor_on_off = document.querySelector('.js-switch-danger-multicolor-on-off');
      var switchery = new Switchery(danger_multicolor_on_off, { color: '#f9616d', secondaryColor: '#43d187', jackColor: '#ffe4e6', jackSecondaryColor: '#a5ecc4' });
      var warning_multicolor_on_off = document.querySelector('.js-switch-warning-multicolor-on-off');
      var switchery = new Switchery(warning_multicolor_on_off, { color: '#f7bb4d', secondaryColor: '#3d9bfb', jackColor: '#fef7e6', jackSecondaryColor: '#c7ecee' });
      var info_multicolor_on_off = document.querySelector('.js-switch-info-multicolor-on-off');
      var switchery = new Switchery(info_multicolor_on_off, { color: '#3d9bfb', secondaryColor: '#f7bb4d', jackColor: '#c7ecee', jackSecondaryColor: '#fef7e6' });
      var light_multicolor_on_off = document.querySelector('.js-switch-light-multicolor-on-off');
      var switchery = new Switchery(light_multicolor_on_off, { color: '#f2f3f7', secondaryColor: '#141d46', jackColor: '#e2e6ea', jackSecondaryColor: '#7e7e7e' });
      var dark_multicolor_on_off = document.querySelector('.js-switch-dark-multicolor-on-off');
      var switchery = new Switchery(dark_multicolor_on_off, { color: '#141d46', secondaryColor: '#f2f3f7', jackColor: '#7e7e7e', jackSecondaryColor: '#e2e6ea' });
}(window.jQuery);