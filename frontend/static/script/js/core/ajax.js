PosnicPro.request = function (params, callback, failure = null) {
    //request: function (method, url, data, callback, offlineData, updateLocal) {
    var method = params.method ? params.method : 'GET';
    var url = API_URL + params.url;
    var data = params.data ? params.data : {};
    var offlineData = params.offlineData;
    var updateLocal = params.updateLocal;

    var forceUpdate = typeof updateLocal === 'undefined' ? 0 : updateLocal;

    // -1 -> do not update local
    // 0 -> do default
    // 1 -> update force
    if (offlineData || PosnicPro.isOffline) {
        var parts = url.split('/');
        var module = parts[1];
        var patt = /^[a-f\d]{24}$/i;
        var id = '';
        var action = '';
        var queryData = data;
        queryData.page = data.page ? data.page : 1;
        queryData.limit = data.limit ? data.limit : 5;
        queryData.filters = data.filters ? JSON.parse(data.filters) : '';
        // var params = PosnicPro.urlToArray(url);
        if (typeof parts[2] !== 'undefined' && patt.test(parts[2]) === true) {
            id = parts[2];
        } else {
            action = parts[2] ? parts[2] : '';
        }

        if (!PosnicPro.offlineModules.includes(module)) {
            PosnicPro.alert('Alert', 'Sorry ! ' + module + ' module do not have offline support ');
            return false;
        }

        if (method === 'GET' && id !== '') {
            db[module].get(id).then(function (data) {
                data = {
                    type: 'success',
                    data: data,
                    message: 'got data'
                }
                callback(data);
            });
        } else if (method === 'GET' && !id && !action) {
            var offset = (queryData.page - 1) * queryData.limit;
            var total = queryData.limit;
            var result;
            if (queryData.filters) {
                if (module === 'branches') {
                    result = db[module]
                } else {
                    result = db[module].where('branch_id').equals(PosnicPro.local.get('branch_id_set'));
                }
                result.filter(function (row) {
                    var keyCount = 0, trueCount = 0;
                    for (var key in queryData.filters) {
                        keyCount++;
                        if (key === 'created_date') {
                            if (row.jsDate <= new Date(queryData.filters.created_date.$lte) && row.jsDate >= new Date(queryData.filters.created_date.$gte)) {
                                trueCount++;
                            } else {
                                trueCount--;
                            }
                        } else {
                            var regEx = new RegExp(queryData.filters[key].$regex, queryData.filters[key].$options);
                            if (regEx.test(row[key])) {
                                trueCount++;
                            } else {
                                trueCount--;
                            }
                        }
                    }
                    return keyCount === trueCount;
                });
                result.count(function (count) {
                    total = count;
                });
            } else {
                if (module === 'branches') {
                    result = db[module]
                } else {
                    result = db[module].where('branch_id').equals(PosnicPro.local.get('branch_id_set'));
                }
                db[module].count(function (count) {
                    total = count;
                });
            }

            result.offset(offset).reverse().limit(queryData.limit).sortBy('jsDate').then(function (results) {
                data = {
                    type: 'success',
                    data: {
                        current_page: queryData.page,
                        per_page: queryData.limit,
                        total: total,
                        total_pages: Math.ceil(total / queryData.limit),
                        list: results
                    },
                    message: 'got data'
                }
                callback(data);
            });
        } else if (method !== 'GET' && action === '') {
            var doc = {
                module: module,
                method: method,
                action: action,
                url: url,
                data: JSON.parse(data),
                time: new Date(),
                branch_id: PosnicPro.local.get('branch_id_set'),
            }
            db.queue.put(doc);
            var returnData = {
                type: 'success',
                data: {sms: false, print: false, mail: false},
                message: 'Successfully Stored in Offline Queue'
            };
            callback(returnData);
        } else {
            PosnicPro.alert('Alert', 'Sorry ! This Operation not supported in Offline Mode');
        }
        return false;
    } else {
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
            PosnicPro.offlineRequest++; // To prevent duplicate calls when page loads
            callback(data);
            if (typeof data.serverDataChange === 'undefined') {
                PosnicPro.offlineRequest = 0;
                forceUpdate = -1;
            }
            if ((PosnicPro.offlineRequest === 1 || forceUpdate === 1) && forceUpdate !== -1) {
                db.offline_hash.toArray(function (row) {
                    // suppose settings changes to limit offline modules or empty db
                    if (row.length !== PosnicPro.offlineModules.length) {
                        db.offline_hash.clear();
                        for (var i = 0; i < PosnicPro.offlineModules.length; i++) {
                            db.offline_hash.put({module: PosnicPro.offlineModules[i], hash: ''});
                        }
                    }
                    for (var j = 0; j < row.length; j++) {
                        if (PosnicPro.offlineModules.includes(row[j].module) && row[j].hash !== data.serverDataChange[row[j].module]) {
                            //PosnicPro.updateLocal(row[j].module, row[j].hash, data.serverDataChange[row[j].module]);
                        }
                    }
                    setTimeout(function () {
                        PosnicPro.offlineRequest = 0;
                    }, 3000); // No check for 1 second
                });
            }
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
                    if (xhr.status === 0 && PosnicPro.local.get("offline_action") === 'enable') {
                        PosnicPro.alert('Alert', 'We deducted Network Failure and switching to <strong> Offline Mode </strong>. If you don\'t  want you can turn of with Right Corner Button', false);
                        PosnicPro.isOffline = true;
                    } else if (xhr.status === 0 || xhr.status === 403) {
                        PosnicPro.alert('error', 'Not connected.\nPlease verify your network connection.');
                        if (!onAuthPage) {
                            window.location = 'login.html';
                        }
                    } else if (xhr.status === 404) {
                        PosnicPro.alert('error', 'The requested page not found. [404]');
                    } else if (xhr.status === 500) {
                        PosnicPro.alert('error', 'Internal Server Error [500].');
                    } else if (error === 'parsererror') {
                        PosnicPro.alert('error', 'Requested JSON parse failed.');
                    } else if (error === 'timeout') {
                        PosnicPro.alert('error', 'Time out error.');
                    } else if (error === 'abort') {
                        PosnicPro.alert('error', 'Ajax request aborted.');
                    } else {
                        PosnicPro.alert('error', 'Uncaught Error.\n' + xhr.responseText);
                    }
                    PosnicPro.users.createCookie('loginuser', '', -1);
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