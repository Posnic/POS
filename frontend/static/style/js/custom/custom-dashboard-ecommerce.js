/*
-------------------------------------------
    : Custom - Dashboard Ecommerce js :
-------------------------------------------
*/
"use strict";
$(document).ready(function() {
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

	 /* -----  Apex Bar Chart ----- */
    var options = {
        chart: {
            height: 290,
            type: 'bar',
            toolbar: {
                show: false
            }
        },
        plotOptions: {
            bar: {
                horizontal: false,
                columnWidth: '30%',
                endingShape: 'rounded'  
            },
        },
        dataLabels: {
            enabled: false
        },
        stroke: {
            show: true,
            width: 3,
            colors: ['transparent']
        },
        colors: ['#506fe4', '#43d187', '#96a3b6'],
        series: [{
            name: 'Net Profit',
            data: [76, 85, 101, 98, 87, 105]
        }, {
            name: 'Revenue',
            data: [44, 55, 57, 56, 61, 58]
        }, {
            name: 'Revenue',
            data: [24, 25, 37, 36, 41, 38]
        }],
        legend: {
            show: false,
        },
        xaxis: {
            categories: ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'],
            axisBorder: {
                show: true, 
                color: 'rgba(0,0,0,0.05)'
            },
            axisTicks: {
                show: true, 
                color: 'rgba(0,0,0,0.05)'
            }
        },
        grid: {
            row: {
                colors: ['transparent', 'transparent'], opacity: .2
            },
            borderColor: 'rgba(0,0,0,0.05)'
        },
        fill: {
            opacity: 1,
        },
        tooltip: {
            y: {
                formatter: function (val) {
                    return "$ " + val + " thousands"
                }
            }
        }
    }
    var chart = new ApexCharts(
        document.querySelector("#apex-bar-chart"),
        options
    );
    chart.render();

});