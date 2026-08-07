
       // Browser supports HTML5 multiple file?
        var multipleSupport = typeof $('<input/>')[0].multiple !== 'undefined',
            isIE = /msie/i.test( navigator.userAgent );

        $.fn.customFile = function() {

          return this.each(function() {

            var $file = $(this).addClass('custom-file-upload-hidden'), // the original file input
                $wrap = $('<div class="file-upload-wrapper">');
                // Button that will be used in non-IE browsers
                $button = $('<label></button>');
                // Hack for IE
                $label = $('<label for="'+ $file[0].id +'"></label>');
            // Hide by shifting to the left so we
            // can still trigger events
            $file.css({
              position: 'absolute',
              left: '-9999px'
            });

            $wrap.insertAfter( $file )
              .append( $file,( isIE ? $label : $button ) );

            // Prevent focus
            $file.attr('tabIndex', -1);
            $button.attr('tabIndex', -1);

            $button.click(function () {
              $('#receive_out').show();
              $file.focus().click(); // Open dialog
            });

            $file.change(function() {

              var files = [], fileArr, filename;
              if ( multipleSupport ) {
                fileArr = $file[0].files;
                for ( var i = 0, len = fileArr.length; i < len; i++ ) {
                  files.push( fileArr[i].name );
                }
                filename = files.join(', ');
              } else {
                filename = $file.val().split('\\').pop();
              }
              $("#receive_out").val(filename);
             });
          });
    };