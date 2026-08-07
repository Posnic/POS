/*
-----------------------------------
    : Custom - Map jVector js :
-----------------------------------
*/
"use strict";
$(document).ready(function() {
    /* -- jVector Map - World Map -- */
    $('#world-map').vectorMap({
        map: 'world_mill_en',
        backgroundColor: 'transparent',
        markerStyle: {
          initial: {
            fill: 'transparent',
            stroke: 'transparent',
            "fill-opacity": 1,
            "stroke-width": 15,
            "stroke-opacity": 0
          }
        },
        markers: [
          {latLng: [37.18, -93.35], name: 'United States'},
          {latLng: [61.52, 105.31], name: 'Russia'},
          {latLng: [20.59, 78.96], name: 'India'}, 
          {latLng: [-25.27, 133.77], name: 'Australia'},
          {latLng: [-38.41, -63.61], name: 'Argentina'},         
        ],
        focusOn: {
          x: 0,
          y: 0,
          scale: 1
        },  
        series: {
          regions: [{
            values: {
                US:'#506fe4',
                RU:'#43d187',
                IN:'#96a3b6',               
            }
          }]
        },    
        regionStyle: {
            initial: {
                fill: '#f2f3f7'
            }
        }
    });

    /* -- jVector Map - USA Map --  */
    $('#usa').vectorMap({map: 'us_aea_en',backgroundColor: 'transparent',
        regionStyle: {
            initial: {
                fill: '#506fe4'
            }
    }});
    /* -- jVector Map - India Map -- */
    $('#india').vectorMap({map: 'in_mill',backgroundColor: 'transparent',
        regionStyle: {
            initial: {
                fill: '#f9616d'
            }
    }});
    /* -- jVector Map - Australia Map -- */
    $('#australia').vectorMap({map : 'au_mill',backgroundColor : 'transparent',
        regionStyle : {
            initial : {
                fill : '#43d187'
            }
    }});
    /* -- jVector Map - Argentina Map -- */
    $('#argentina').vectorMap({map: 'ar_mill',backgroundColor: 'transparent',
        regionStyle: {
            initial: {
                fill: '#f7bb4d'
            }
    }});
    /* -- jVector Map - Russia Map -- */
    $('#russia').vectorMap({map: 'ru_mill',backgroundColor: 'transparent',
        regionStyle: {
            initial: {
                fill: '#3d9bfb'
            }
    }});
    /* -- jVector Map - South Africa Map -- */
    $('#south-africa').vectorMap({map: 'za_mill',backgroundColor: 'transparent',
        regionStyle: {
            initial: {
                fill: '#96a3b6'
            }
    }});
});