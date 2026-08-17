PosnicPro.request = function (params, callback, failure = null) {
    var method = params.method ? params.method : 'GET';
    var url = API_URL + params.url;
    var data = params.data ? params.data : {};


    /*
     * The offline layer that used to live here (Dexie mirror reads and a
     * write-queue) was removed: the mirrors were never populated, and the
     * queue was write-only - an offline sale was silently discarded while
     * the cashier saw a success toast. Requests now always go to the API;
     * a network failure surfaces honestly in the error handler below.
     */
    {
        // JWT Token support for Electron cross-origin requests
        var headers = {};
        if (navigator.userAgent.indexOf('Electron') !== -1) {
            const token = localStorage.getItem('posnic_jwt_token');
            if (token) {
                headers['Authorization'] = 'Bearer ' + token;
                console.log('✅ JWT added to PosnicPro.request:', url.substring(0, 50) + '...');
            } else {
                console.log('❌ No JWT for PosnicPro.request:', url.substring(0, 50) + '...');
            }
        }

        var request = $.ajax({
            url: url,
            method: method,
            dataType: 'json',
            headers: headers,
            xhrFields: {
                withCredentials: true
            },
            contentType: 'application/json',
            data: data
        });

        request.done(function (data) {
            callback(data);
        });

        request.fail(function (xhr, status, error) {
            $(".loadingSpinner").remove();

            // A non-JSON body (proxy error page, dropped connection, offline)
            // used to throw here and kill the whole handler, so the user saw
            // nothing at all. Fall back to null and keep going.
            let response = xhr.responseJSON || null;
            if (!response && xhr.responseText) {
                try {
                    response = JSON.parse(xhr.responseText);
                } catch (e) {
                    response = null;
                }
            }

            // login.html / forgotpassword.html have no session by definition.
            // Redirecting to login from here just reloads the page and wipes
            // the error message before it can be read.
            var onAuthPage = /(^|\/)(login|forgotpassword|ssoauth)\.html$/i.test(window.location.pathname) ||
                    window.location.pathname === '/' || window.location.pathname === '';

            var isThemeSettingsMissing = false;
            if (url.indexOf('setting/getThemeSettings') !== -1 && response && response.type === 'error' && response.message === 'No theme settings found') {
                isThemeSettingsMissing = true;
                if (typeof PosnicPro !== 'undefined' && PosnicPro.themeManager && PosnicPro.themeManager.defaults) {
                    try {
                        var defaultSettings = Object.assign({}, PosnicPro.themeManager.defaults);
                        PosnicPro.themeManager.applyTheme(defaultSettings);
                        PosnicPro.themeManager.saveToLocal(defaultSettings);
                    } catch (e) {
                    }
                }
            }

            if (!isThemeSettingsMissing && response && response.message) {
                PosnicPro.alert(response.type || 'error', response.message);
            }

            /*
             * Any 401 sends the user back to sign in, carrying the reason.
             *
             * This used to match one exact sentence - "Not valid Session" - so
             * every other way of being unauthenticated left the till showing a
             * red toast and then just sitting there: signed out, unable to do
             * anything, with no way back except knowing to reload. The server
             * has at least four such messages ("Invalid token. Please log in
             * again!", "Your session has expired.", "You are not logged in!",
             * and that one), and it grew another the day a secret was rotated.
             *
             * The status code is the thing that actually means "not
             * authenticated", so that is what is checked. The message is passed
             * to the sign-in page rather than shown and abandoned, because
             * "your session expired" and "invalid token" send the person to
             * different places: one waits, the other calls somebody.
             */
            var unauthenticated = xhr.status === 401
                || (response && response.type === "error"
                    && response.message === "Not valid Session" && response.data === null);

            if (!isThemeSettingsMissing && unauthenticated) {
                if (navigator.userAgent.indexOf('Electron') !== -1) {
                    localStorage.removeItem('posnic_jwt_token');
                    console.log('JWT token cleared on session invalidation');
                }
                PosnicPro.users.createCookie('loginuser', '', -1);
                if (!onAuthPage) {
                    var reason = (response && response.message)
                        || 'Your session has ended. Please sign in again.';
                    window.location = 'login.html?msg=' + encodeURIComponent(reason)
                        + '&type=error';
                    return false;   // nothing below can help once we are leaving
                }
            }
            if (!isThemeSettingsMissing && !onAuthPage && (typeof (PosnicPro.local.get('username')) === "undefined" || PosnicPro.local.get('username') === null || PosnicPro.local.get('username') === "")) {
                window.location = 'login.html';
            }
            if (failure !== null) {
                failure(xhr)
            } else {
                if (!isThemeSettingsMissing && !(response && response.message)) {
                    /*
                     * Honest failures only. This branch used to expire the
                     * login cookie for EVERY status below (a 404 logged the
                     * cashier out mid-sale), redirect to login on a network
                     * blip (status 0), and dump the raw HTTP body into a
                     * toast. Authentication problems are already handled by
                     * the 401 branch above; everything here just tells the
                     * person what happened and lets them carry on.
                     */
                    if (xhr.status === 0) {
                        PosnicPro.alert('error', 'No connection. Check the network and try again - nothing was saved.');
                    } else if (xhr.status === 403) {
                        PosnicPro.alert('error', 'You do not have permission for that.');
                    } else if (xhr.status === 404) {
                        PosnicPro.alert('error', 'That could not be found. Try refreshing the page.');
                    } else if (xhr.status >= 500) {
                        PosnicPro.alert('error', 'The server hit a problem. Try again in a moment.');
                    } else if (error === 'timeout') {
                        PosnicPro.alert('error', 'The server took too long. Try again.');
                    } else if (error === 'abort') {
                        return false; // a cancelled request is not an error to shout about
                    } else {
                        console.error('Unhandled request failure:', xhr.status, xhr.responseText);
                        PosnicPro.alert('error', 'Something went wrong. Try again, and check the network if it keeps happening.');
                    }
                    return false;
                }
            }
        });
    }
};

PosnicPro.get = function (params, callback, failure) {
    var parameters = {};
    if (typeof params === 'string') {
        parameters.url = params;
        parameters.data = {}
    } else {
        parameters = params;
    }
    parameters.method = 'GET';
    PosnicPro.request(parameters, callback, failure);
};

PosnicPro.post = function (params, callback, failure) {
    var parameters = {};
    if (typeof params === 'string') {
        parameters.url = params;
        parameters.data = {}
    } else {
        parameters = params;
    }
    parameters.method = 'POST';
    PosnicPro.request(parameters, callback, failure);
};

PosnicPro.delete = function (params, callback, failure) {
    var parameters = {};
    if (typeof params === 'string') {
        parameters.url = params;
        parameters.data = {}
    } else {
        parameters = params;
    }
    parameters.method = 'DELETE';
    PosnicPro.request(parameters, callback, failure);
};

PosnicPro.put = function (params, callback, failure) {
    var parameters = {};
    if (typeof params === 'string') {
        parameters.url = params;
        parameters.data = {}
    } else {
        parameters = params;
    }
    parameters.method = 'PUT';
    PosnicPro.request(parameters, callback, failure);
};

PosnicPro.patch = function (params, callback, failure) {
    var parameters = {};
    if (typeof params === 'string') {
        parameters.url = params;
        parameters.data = {}
    } else {
        parameters = params;
    }
    parameters.method = 'PATCH';
    PosnicPro.request(parameters, callback, failure);
};