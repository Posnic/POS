/*
---------------------------------
    : Custom - Widgets js :
---------------------------------
*/
"use strict";
$(document).ready(function() {   
    /* -----  Apex Area1 Chart ----- */
    var options = {
        chart: {
            type:"area",
            height: 50,
            sparkline: {
                enabled: true
            }
        },
        stroke: {
            curve: "straight",
            width: 2
        },
        fill: {
            opacity: .05
        },
        series:[ {
            data: [5, 12, 10, 18, 11, 16]
        }
        ],
        yaxis: {
            min: 0
        },
        colors:["#506fe4"],
        grid: {
            row: {
                colors: ['transparent', 'transparent'], opacity: .2
            },
            borderColor: 'transparent'
        },
        tooltip: {
            x: {
                format: 'dd/MM/yy HH:mm'
            },
        }
    }
    var chart = new ApexCharts(
        document.querySelector("#apex-area1-chart"),
        options
    );
    chart.render();

    /* -----  Apex Area2 Chart ----- */
    var options = {
        chart: {
            type:"area",
            height: 50,
            sparkline: {
                enabled: true
            }
        },
        stroke: {
            curve: "straight",
            width: 2
        },
        fill: {
            opacity: .05
        },
        series:[ {
            data: [5, 12, 10, 18, 11, 16]
        }
        ],
        yaxis: {
            min: 0
        },
        colors:["#43d187"],
        grid: {
            row: {
                colors: ['transparent', 'transparent'], opacity: .2
            },
            borderColor: 'transparent'
        },
        tooltip: {
            x: {
                format: 'dd/MM/yy HH:mm'
            },
        }
    }
    var chart = new ApexCharts(
        document.querySelector("#apex-area2-chart"),
        options
    );
    chart.render();

    /* -----  Apex Area3 Chart ----- */
    var options = {
        chart: {
            type:"area",
            height: 50,
            sparkline: {
                enabled: true
            }
        },
        stroke: {
            curve: "straight",
            width: 2
        },
        fill: {
            opacity: .05
        },
        series:[ {
            data: [5, 12, 10, 18, 11, 16]
        }
        ],
        yaxis: {
            min: 0
        },
        colors:["#96a3b6"],
        grid: {
            row: {
                colors: ['transparent', 'transparent'], opacity: .2
            },
            borderColor: 'transparent'
        },
        tooltip: {
            x: {
                format: 'dd/MM/yy HH:mm'
            },
        }
    }
    var chart = new ApexCharts(
        document.querySelector("#apex-area3-chart"),
        options
    );
    chart.render();

    /* -- User Slider -- */
    $('.user-slider').slick({
        arrows: true,
        dots: false,
        infinite: true,
        adaptiveHeight: true,
        slidesToShow: 1,
        slidesToScroll: 1,
        prevArrow: '<i class="feather icon-arrow-left"></i>',
        nextArrow: '<i class="feather icon-arrow-right"></i>'
    });

    /* ----- Apex Operation Status1 Chart ----- */
    var options = {
        chart: {
            height: 260,
            type: 'radialBar',
            offsetY: -10
        },
        plotOptions: {
            radialBar: {
                startAngle: -135,
                endAngle: 135,
                dataLabels: {
                    name: {
                        fontSize: '18px',
                        fontFamily: 'Mukta Vaani',
                        color: '#8A98AC',
                        offsetY: 120
                    },
                    value: {
                        offsetY: 76,
                        fontSize: '24px',
                        fontFamily: 'Mukta Vaani',
                        color: '#141d46',
                        formatter: function (val) {
                            return val + "%";
                        }
                    }
                }
            }
        },
        fill: {
            type: 'gradient',
            gradient: {
                shade: 'dark',
                shadeIntensity: 0.15,
                inverseColors: false,
                opacityFrom: 1,
                opacityTo: 1,
                stops: [0, 50, 65, 91]
            },
        },
        stroke: {
            dashArray: 4
        },
        colors:["#506fe4"],
        series: [65],
        labels: ['Completed'],        
    }
    var chart = new ApexCharts(
        document.querySelector("#apex-operation-status1-chart"),
        options
    );        
    chart.render();

    /* ----- Apex Operation Status2 Chart ----- */
    var options = {
        chart: {
            height: 260,
            type: 'radialBar',
            offsetY: -10
        },
        plotOptions: {
            radialBar: {
                startAngle: -135,
                endAngle: 135,
                dataLabels: {
                    name: {
                        fontSize: '18px',
                        fontFamily: 'Mukta Vaani',
                        color: '#8A98AC',
                        offsetY: 120
                    },
                    value: {
                        offsetY: 76,
                        fontSize: '24px',
                        fontFamily: 'Mukta Vaani',
                        color: '#141d46',
                        formatter: function (val) {
                            return val + "%";
                        }
                    }
                }
            }
        },
        fill: {
            type: 'gradient',
            gradient: {
                shade: 'dark',
                shadeIntensity: 0.15,
                inverseColors: false,
                opacityFrom: 1,
                opacityTo: 1,
                stops: [0, 50, 65, 91]
            },
        },
        stroke: {
            dashArray: 4
        },
        colors:["#506fe4"],
        series: [85],
        labels: ['Completed'],        
    }
    var chart = new ApexCharts(
        document.querySelector("#apex-operation-status2-chart"),
        options
    );        
    chart.render();

    /* ----- Apex Operation Status3 Chart ----- */
    var options = {
        chart: {
            height: 260,
            type: 'radialBar',
            offsetY: -10
        },
        plotOptions: {
            radialBar: {
                startAngle: -135,
                endAngle: 135,
                dataLabels: {
                    name: {
                        fontSize: '18px',
                        fontFamily: 'Mukta Vaani',
                        color: '#8A98AC',
                        offsetY: 120
                    },
                    value: {
                        offsetY: 76,
                        fontSize: '24px',
                        fontFamily: 'Mukta Vaani',
                        color: '#141d46',
                        formatter: function (val) {
                            return val + "%";
                        }
                    }
                }
            }
        },
        fill: {
            type: 'gradient',
            gradient: {
                shade: 'dark',
                shadeIntensity: 0.15,
                inverseColors: false,
                opacityFrom: 1,
                opacityTo: 1,
                stops: [0, 50, 65, 91]
            },
        },
        stroke: {
            dashArray: 4
        },
        colors:["#506fe4"],
        series: [50],
        labels: ['Completed'],        
    }
    var chart = new ApexCharts(
        document.querySelector("#apex-operation-status3-chart"),
        options
    );        
    chart.render();

    /* ----- Apex Operation Status4 Chart ----- */
    var options = {
        chart: {
            height: 260,
            type: 'radialBar',
            offsetY: -10
        },
        plotOptions: {
            radialBar: {
                startAngle: -135,
                endAngle: 135,
                dataLabels: {
                    name: {
                        fontSize: '18px',
                        fontFamily: 'Mukta Vaani',
                        color: '#8A98AC',
                        offsetY: 120
                    },
                    value: {
                        offsetY: 76,
                        fontSize: '24px',
                        fontFamily: 'Mukta Vaani',
                        color: '#141d46',
                        formatter: function (val) {
                            return val + "%";
                        }
                    }
                }
            }
        },
        fill: {
            type: 'gradient',
            gradient: {
                shade: 'dark',
                shadeIntensity: 0.15,
                inverseColors: false,
                opacityFrom: 1,
                opacityTo: 1,
                stops: [0, 50, 65, 91]
            },
        },
        stroke: {
            dashArray: 4
        },
        colors:["#506fe4"],
        series: [35],
        labels: ['Completed'],        
    }
    var chart = new ApexCharts(
        document.querySelector("#apex-operation-status4-chart"),
        options
    );        
    chart.render();

    /* -- Vector Map -- */    
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

    /* -- Apex Circle Chart -- */
    var options = {
      series: [76, 67, 61, 90],
      chart: {
      height: 300,
      type: 'radialBar',
    },
    plotOptions: {
      radialBar: {
        offsetY: 0,
        startAngle: 0,
        endAngle: 270,
        hollow: {
          margin: 5,
          size: '30%',
          background: 'transparent',
          image: undefined,
        },
        dataLabels: {
          name: {
            show: false,
          },
          value: {
            show: false,
          }
        }
      }
    },
    colors: ['#506fe4', '#43d187', '#f7bb4d', '#96a3b6'],
    labels: ['Website', 'Mobile', 'Offline', 'Direct'],
    legend: {
      show: true,
      floating: true,
      fontSize: '16px',
      position: 'left',
      offsetX: 0,
      offsetY: 0,
      labels: {
        useSeriesColors: true,
      },
      markers: {
        size: 0
      },
      formatter: function(seriesName, opts) {
        return seriesName + ":  " + opts.w.globals.series[opts.seriesIndex]
      },
      itemMargin: {
        horizontal: 3,
      }
    },
    responsive: [{
      breakpoint: 480,
      options: {
        legend: {
            show: false
        }
      }
    }]
    };

    var chart = new ApexCharts(document.querySelector("#apex-circle-chart"), options);
    chart.render();

    /* -- Product Slider -- */
    $('.product-slider').slick({
        arrows: true,
        dots: false,
        infinite: true,
        adaptiveHeight: true,
        slidesToShow: 1,
        slidesToScroll: 1,
        prevArrow: '<i class="feather icon-arrow-left"></i>',
        nextArrow: '<i class="feather icon-arrow-right"></i>'
    });
    
});