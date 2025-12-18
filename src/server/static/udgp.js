/**
 * UDGP Penalty System
 * Adds -2 lap penalty checkbox to Run and Marshal pages
 */

jQuery(document).ready(function($) {
    'use strict';

    // Wait for socket to be ready
    function waitForSocket(callback) {
        if (typeof socket !== 'undefined' && socket && socket.on) {
            callback();
        } else {
            setTimeout(function() { waitForSocket(callback); }, 100);
        }
    }

    waitForSocket(function() {
        initPenaltySystem($);
    });
});

function initPenaltySystem($) {
    'use strict';

    // Detect current page
    var isRunPage = document.querySelector('.page-race') !== null;
    var isMarshalPage = document.querySelector('.page-marshal') !== null;

    if (!isRunPage && !isMarshalPage) {
        return; // Not on a relevant page
    }

    // Current penalties state
    var penalties = {};
    var currentRaceId = null; // null = current race, int = saved race

    // Update functions (defined at this scope so updateAllCheckboxes can call them)
    var updateRunCheckboxes = function() {};
    var updateMarshalCheckbox = function() {};

    // ========================================
    // Socket.IO Event Handlers
    // ========================================

    // Listen for penalty data from server
    socket.on('penalties_data', function(data) {
        penalties = data.penalties || {};
        currentRaceId = data.race_id;
        updateAllCheckboxes();
    });

    function updateAllCheckboxes() {
        if (isRunPage) {
            updateRunCheckboxes();
        }
        if (isMarshalPage) {
            updateMarshalCheckbox();
        }
    }

    // ========================================
    // Run Page
    // ========================================

    if (isRunPage) {
        function getPilotIdForNode(nodeIndex) {
            // Get pilot ID from rotorhazard.current_heatNodes
            if (typeof rotorhazard !== 'undefined' &&
                rotorhazard.current_heatNodes &&
                rotorhazard.current_heatNodes[nodeIndex] &&
                rotorhazard.current_heatNodes[nodeIndex].pilot_id) {
                return rotorhazard.current_heatNodes[nodeIndex].pilot_id;
            }
            return null;
        }

        updateRunCheckboxes = function() {
            document.querySelectorAll('.udgp-penalty-cb').forEach(function(cb) {
                var nodeIndex = parseInt(cb.dataset.node);
                var pilotId = getPilotIdForNode(nodeIndex);
                cb.checked = pilotId && penalties[pilotId] === true;
            });
        };

        function onRunCheckboxChange(e) {
            var nodeIndex = parseInt(e.target.dataset.node);
            var pilotId = getPilotIdForNode(nodeIndex);

            if (pilotId) {
                socket.emit('set_penalty', {
                    race_id: null, // Current race
                    pilot_id: pilotId,
                    penalty: e.target.checked
                });
            }
        }

        // Add penalty column to leaderboard
        function addPenaltyColumn() {
            var table = document.querySelector('.leaderboard');
            if (!table) return;

            // Add header if not exists
            var headerRow = table.querySelector('thead tr, tr:first-child');
            if (headerRow && !headerRow.querySelector('.penalty-header')) {
                // Find the Pilot column (usually 2nd column)
                var pilotHeader = headerRow.querySelectorAll('th, td')[1];
                if (pilotHeader) {
                    var th = document.createElement('th');
                    th.className = 'penalty-header';
                    th.textContent = 'Penalty';
                    th.style.cssText = 'width: 60px; text-align: center;';
                    pilotHeader.parentNode.insertBefore(th, pilotHeader.nextSibling);
                }
            }

            // Add checkbox cells to each row
            var rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
            rows.forEach(function(row, index) {
                if (row.querySelector('.penalty-cell')) return; // Already added

                var pilotCell = row.querySelectorAll('td')[1];
                if (!pilotCell) return;

                var td = document.createElement('td');
                td.className = 'penalty-cell';
                td.style.cssText = 'text-align: center;';
                td.innerHTML = '<input type="checkbox" class="udgp-penalty-cb" data-node="' + index + '" title="Apply -2 lap penalty">';
                pilotCell.parentNode.insertBefore(td, pilotCell.nextSibling);
            });

            // Attach event handlers
            table.querySelectorAll('.udgp-penalty-cb').forEach(function(cb) {
                cb.removeEventListener('change', onRunCheckboxChange);
                cb.addEventListener('change', onRunCheckboxChange);
            });

            updateRunCheckboxes();
        }

        // Observe DOM changes to add penalty column when leaderboard updates
        var runObserver = new MutationObserver(function(mutations) {
            addPenaltyColumn();
        });

        var leaderboard = document.querySelector('#leaderboard');
        if (leaderboard) {
            runObserver.observe(leaderboard, {
                childList: true,
                subtree: true
            });
        }

        // Initial setup
        setTimeout(addPenaltyColumn, 500);

        // Request current penalties
        socket.emit('get_penalties', { race_id: null });

        // Also listen for heat changes to refresh penalties
        socket.on('heat_data', function() {
            setTimeout(function() {
                addPenaltyColumn();
                socket.emit('get_penalties', { race_id: null });
            }, 200);
        });
    }

    // ========================================
    // Marshal Page
    // ========================================

    if (isMarshalPage) {
        var marshalRaceId = null;

        updateMarshalCheckbox = function() {
            var cb = document.getElementById('marshal-penalty-cb');
            if (!cb || !window.current_race_data) return;

            var pilotId = window.current_race_data.pilot_id;
            cb.checked = pilotId && penalties[pilotId] === true;
        };

        function onMarshalCheckboxChange(e) {
            if (!marshalRaceId || !window.current_race_data) return;

            var pilotId = window.current_race_data.pilot_id;
            if (pilotId) {
                socket.emit('set_penalty', {
                    race_id: marshalRaceId,
                    pilot_id: pilotId,
                    penalty: e.target.checked
                });
            }
        }

        // Inject checkbox into sidebar
        function injectMarshalCheckbox() {
            var sidebar = document.querySelector('.sidebar-controls');
            if (!sidebar) return;

            // Skip if already injected
            if (document.getElementById('marshal-penalty-cb')) {
                return;
            }

            // Create a section similar to other sidebar sections
            var section = document.createElement('div');
            section.className = 'control-block udgp-penalty-section';
            section.innerHTML =
                '<h3>UDGP Penalty</h3>' +
                '<label class="udgp-penalty-label">' +
                '<input type="checkbox" id="marshal-penalty-cb"> ' +
                '-2 Laps Penalty' +
                '</label>';

            // Insert at top of sidebar
            sidebar.insertBefore(section, sidebar.firstChild);

            // Attach event handler
            var cb = document.getElementById('marshal-penalty-cb');
            if (cb) {
                cb.addEventListener('change', onMarshalCheckboxChange);
            }
        }

        // Hook into race loading
        var originalLoadRace = window.load_race;
        if (typeof originalLoadRace === 'function') {
            window.load_race = function() {
                originalLoadRace.apply(this, arguments);

                // Get race_id from current selection
                setTimeout(function() {
                    if (window.current_race_data && window.current_race_data.race_id) {
                        marshalRaceId = window.current_race_data.race_id;
                        socket.emit('get_penalties', { race_id: marshalRaceId });
                    }
                    injectMarshalCheckbox();
                }, 100);
            };
        }

        // Observe DOM changes
        var marshalObserver = new MutationObserver(function(mutations) {
            injectMarshalCheckbox();
        });

        var marshalContent = document.querySelector('.page-marshal .panel-content');
        if (marshalContent) {
            marshalObserver.observe(marshalContent, {
                childList: true,
                subtree: true
            });
        }

        // Initial setup
        setTimeout(injectMarshalCheckbox, 500);
    }

    // ========================================
    // Styles
    // ========================================

    var style = document.createElement('style');
    style.textContent =
        '.penalty-header { background: #fff3cd !important; }' +
        '.penalty-cell { background: #fffbf0; }' +
        '.udgp-penalty-cb { width: 18px; height: 18px; cursor: pointer; }' +
        '.udgp-penalty-wrap { padding: 8px 12px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; margin: 10px 0; }' +
        '.udgp-penalty-label { display: flex; align-items: center; gap: 8px; cursor: pointer; }';
    document.head.appendChild(style);

    console.log('UDGP: Initialized on', isRunPage ? 'Run' : 'Marshal', 'page');
}
