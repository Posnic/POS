/*
-------------------------------------------
    : Custom - Dashboard Hospital js :
-------------------------------------------
*/
"use strict";
$(document).ready(function() {    
    /* -----  Apex Line1 Chart ----- */
    var options = {
        chart: {
            height: 50,
            type: 'line',
            sparkline: {
                enabled: true
            },
            toolbar: {
                show: false
            },
            zoom: {
                enabled: false
            }
        },
        colors: ['#506fe4'],
        series: [{
            name: "Appointment",
            data: [1, 12, 10, 16, 11, 18]
        }],
        dataLabels: {
            enabled: false
        },
        stroke: {
            curve: 'smooth',
            width: 2
        },
        grid: {
            row: {
                colors: ['transparent', 'transparent'], opacity: .2
            },
            borderColor: 'transparent'
        },
        yaxis: {
            min: 0
        },
        xaxis: {
            categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
            axisBorder: {
                show: true, 
                color: 'rgba(0,0,0,0.05)'
            },
            axisTicks: {
                show: true, 
                color: 'rgba(0,0,0,0.05)'
            }
        }
    }
    var chart = new ApexCharts(
        document.querySelector("#apex-line1-chart"),
        options
    );
    chart.render();

    /* -----  Apex Line2 Chart ----- */
    var options = {
        chart: {
            height: 50,
            type: 'line',
            sparkline: {
                enabled: true
            },
            toolbar: {
                show: false
            },
            zoom: {
                enabled: false
            }
        },
        colors: ['#43d187'],
        series: [{
            name: "Appointment",
            data: [1, 12, 10, 16, 11, 18]
        }],
        dataLabels: {
            enabled: false
        },
        stroke: {
            curve: 'smooth',
            width: 2
        },
        grid: {
            row: {
                colors: ['transparent', 'transparent'], opacity: .2
            },
            borderColor: 'transparent'
        },
        yaxis: {
            min: 0
        },
        xaxis: {
            categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
            axisBorder: {
                show: true, 
                color: 'rgba(0,0,0,0.05)'
            },
            axisTicks: {
                show: true, 
                color: 'rgba(0,0,0,0.05)'
            }
        }
    }
    var chart = new ApexCharts(
        document.querySelector("#apex-line2-chart"),
        options
    );
    chart.render();

    /* -----  Apex Line3 Chart ----- */
    var options = {
        chart: {
            height: 50,
            type: 'line',
            sparkline: {
                enabled: true
            },
            toolbar: {
                show: false
            },
            zoom: {
                enabled: false
            }
        },
        colors: ['#f7bb4d'],
        series: [{
            name: "Appointment",
            data: [1, 12, 10, 16, 11, 18]
        }],
        dataLabels: {
            enabled: false
        },
        stroke: {
            curve: 'smooth',
            width: 2
        },
        grid: {
            row: {
                colors: ['transparent', 'transparent'], opacity: .2
            },
            borderColor: 'transparent'
        },
        yaxis: {
            min: 0
        },
        xaxis: {
            categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
            axisBorder: {
                show: true, 
                color: 'rgba(0,0,0,0.05)'
            },
            axisTicks: {
                show: true, 
                color: 'rgba(0,0,0,0.05)'
            }
        }
    }
    var chart = new ApexCharts(
        document.querySelector("#apex-line3-chart"),
        options
    );
    chart.render();

    /* -----  Apex Line4 Chart ----- */
    var options = {
        chart: {
            height: 50,
            type: 'line',
            sparkline: {
                enabled: true
            },
            toolbar: {
                show: false
            },
            zoom: {
                enabled: false
            }
        },
        colors: ['#96a3b6'],
        series: [{
            name: "Appointment",
            data: [1, 12, 10, 16, 11, 18]
        }],
        dataLabels: {
            enabled: false
        },
        stroke: {
            curve: 'smooth',
            width: 2
        },
        grid: {
            row: {
                colors: ['transparent', 'transparent'], opacity: .2
            },
            borderColor: 'transparent'
        },
        yaxis: {
            min: 0
        },
        xaxis: {
            categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
            axisBorder: {
                show: true, 
                color: 'rgba(0,0,0,0.05)'
            },
            axisTicks: {
                show: true, 
                color: 'rgba(0,0,0,0.05)'
            }
        }
    }
    var chart = new ApexCharts(
        document.querySelector("#apex-line4-chart"),
        options
    );
    chart.render();

    /* -- Apex Line Column Area Chart -- */
    var options = {
      series: [{
      name: 'Expenditure',
      type: 'column',
      data: [23, 11, 22, 27, 13, 22, 37, 21, 44, 22, 30]
    }, {
      name: 'Maintenance',
      type: 'area',
      data: [44, 55, 41, 67, 22, 43, 21, 41, 56, 27, 43]
    }, {
      name: 'Profit',
      type: 'line',
      data: [30, 25, 36, 30, 45, 35, 64, 52, 59, 36, 39]
    }],
      chart: {
      height: 358,
      type: 'line',
      stacked: false,
      toolbar: {
        show: false
      }
    },
    stroke: {
      width: [0, 1, 3],
      curve: 'smooth'
    },
    plotOptions: {
      bar: {
        columnWidth: '25%'
      }
    },
    colors: ['#506fe4','#43d187','#96a3b6'],
    fill: {
      opacity: [0.85, 0.25, 1],
      gradient: {
        inverseColors: false,
        shade: 'light',
        type: "vertical",
        opacityFrom: 0.85,
        opacityTo: 0.55,
        stops: [0, 100, 100, 100]
      }
    },
    labels: ['01/01/2003', '02/01/2003', '03/01/2003', '04/01/2003', '05/01/2003', '06/01/2003', '07/01/2003',
      '08/01/2003', '09/01/2003', '10/01/2003', '11/01/2003'
    ],
    markers: {
      size: 0
    },
    xaxis: {
      type: 'datetime'
    },
    yaxis: {      
      min: 0
    },
    tooltip: {
      shared: true,
      intersect: false,
      y: {
        formatter: function (y) {
          if (typeof y !== "undefined") {
            return y.toFixed(0) + " points";
          }
          return y;
    
        }
      }
    }
    };

    var chart = new ApexCharts(document.querySelector("#apex-line-column-area-chart"), options);
    chart.render();

    /* -----  Apex Donut Chart ----- */
    var options = {
        chart: {
            type: 'donut',
            width: 330,
        },
        plotOptions: {
            pie: {
                donut: {
                    size: "85%"
                }
            }
        },
        dataLabels: {
            enabled: false
        },
        colors: ['#506fe4', '#43d187','#96a3b6'],
        series: [60, 45, 25],
        labels: ['Child', 'Adult', 'Aged'],
        legend: {
            show: true,
            position: 'bottom'
        },
        responsive: [{
          breakpoint: 480,
          options: {
            chart: {
                width: 230,
            }
          }
        }]
    }
    var chart = new ApexCharts(
        document.querySelector("#apex-pie-chart"),
        options
    );        
    chart.render();
});