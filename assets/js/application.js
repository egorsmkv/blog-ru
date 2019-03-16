/*!
 * Adapted from Bootstrap docs JavaScript
 */

!function ($) {

    $(function () {

        // IE10 viewport hack for Surface/desktop Windows 8 bug
        //
        // See Getting Started docs for more information
        if (navigator.userAgent.match(/IEMobile\/10\.0/)) {
            var msViewportStyle = document.createElement('style');
            msViewportStyle.appendChild(
                document.createTextNode(
                    '@-ms-viewport{width:auto!important}'
                )
            );
            document.querySelector('head').appendChild(msViewportStyle)
        }

        var $window = $(window);
        var $body = $(document.body);

        $body.scrollspy({
            target: '.sidebar',
            offset: 20 // required to select the right thing. if this is smaller then you are at the top of one section
                       // but the next section is highlighted
        });

        $window.on('load', function () {
            $body.scrollspy('refresh')
        });

        $('.docs-container [href=#]').click(function (e) {
            e.preventDefault()
        });

    })

}(jQuery);
