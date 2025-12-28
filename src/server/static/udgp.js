/**
 * UDGP Penalty & Disqualification System
 * Adds -2 lap penalty and DQ (disqualified = 0 laps) checkboxes to Run and Marshal pages
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
        initUDGPSystem($);
    });
});

function initUDGPSystem($) {
    'use strict';

    // Detect current page
    var isRunPage = document.querySelector('.page-race') !== null;
    var isMarshalPage = document.querySelector('.page-marshal') !== null;

    if (!isRunPage && !isMarshalPage) {
        return; // Not on a relevant page
    }

    // Current state
    var penalties = {};
    var disqualifications = {};
    var currentRaceId = null; // null = current race, int = saved race

    // Replay state
    var replayHeats = [];
    var replayStatus = 'idle'; // 'idle', 'starting', 'replaying'

    // Update functions (defined at this scope so updateAllCheckboxes can call them)
    var updateRunCheckboxes = function() {};
    var updateMarshalCheckboxes = function() {};

    // ========================================
    // Socket.IO Event Handlers
    // ========================================

    // Listen for penalty data from server
    socket.on('penalties_data', function(data) {
        penalties = data.penalties || {};
        currentRaceId = data.race_id;
        updateAllCheckboxes();
    });

    // Listen for disqualification data from server
    socket.on('disqualifications_data', function(data) {
        disqualifications = data.disqualifications || {};
        currentRaceId = data.race_id;
        updateAllCheckboxes();
    });

    function updateAllCheckboxes() {
        if (isRunPage) {
            updateRunCheckboxes();
        }
        if (isMarshalPage) {
            updateMarshalCheckboxes();
        }
    }

    // ========================================
    // Run Page
    // ========================================

    if (isRunPage) {
        updateRunCheckboxes = function() {
            // Update penalty checkboxes
            document.querySelectorAll('.udgp-penalty-cb').forEach(function(cb) {
                var pilotId = cb.dataset.pilotId ? parseInt(cb.dataset.pilotId) : null;
                cb.checked = pilotId && penalties[pilotId] === true;
            });
            // Update DQ checkboxes
            document.querySelectorAll('.udgp-dq-cb').forEach(function(cb) {
                var pilotId = cb.dataset.pilotId ? parseInt(cb.dataset.pilotId) : null;
                cb.checked = pilotId && disqualifications[pilotId] === true;
            });
        };

        function onRunPenaltyChange(e) {
            var pilotId = e.target.dataset.pilotId;
            if (pilotId) {
                pilotId = parseInt(pilotId);
                socket.emit('set_penalty', {
                    race_id: null, // Current race
                    pilot_id: pilotId,
                    penalty: e.target.checked
                });
            }
        }

        function onRunDQChange(e) {
            var pilotId = e.target.dataset.pilotId;
            if (pilotId) {
                pilotId = parseInt(pilotId);
                socket.emit('set_disqualification', {
                    race_id: null, // Current race
                    pilot_id: pilotId,
                    disqualified: e.target.checked
                });
            }
        }

        // Add penalty and DQ columns to leaderboard
        function addColumns() {
            var table = document.querySelector('.leaderboard');
            if (!table) return;

            // Add headers if not exists
            var headerRow = table.querySelector('thead tr, tr:first-child');
            if (headerRow && !headerRow.querySelector('.penalty-header')) {
                // Find the Pilot column (usually 2nd column)
                var pilotHeader = headerRow.querySelectorAll('th, td')[1];
                if (pilotHeader) {
                    // Add Penalty header
                    var thPenalty = document.createElement('th');
                    thPenalty.className = 'penalty-header';
                    thPenalty.textContent = 'Penalty';
                    thPenalty.style.cssText = 'width: 60px; text-align: center;';
                    pilotHeader.parentNode.insertBefore(thPenalty, pilotHeader.nextSibling);

                    // Add DQ header
                    var thDQ = document.createElement('th');
                    thDQ.className = 'dq-header';
                    thDQ.textContent = 'DQ';
                    thDQ.style.cssText = 'width: 50px; text-align: center;';
                    thPenalty.parentNode.insertBefore(thDQ, thPenalty.nextSibling);
                }
            }

            // Add checkbox cells to each row
            var rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
            rows.forEach(function (row) {
                if (row.querySelector('.penalty-cell')) return; // Already added

                var pilotCell = row.querySelectorAll('td')[1];
                if (!pilotCell) return;

                // Get callsign from the row and find the matching pilot_id
                var callsign = pilotCell.textContent.trim();
                var pilotId = null;
                if (typeof rotorhazard !== 'undefined' && rotorhazard.current_heatNodes) {
                    for (var nodeIdx in rotorhazard.current_heatNodes) {
                        var hn = rotorhazard.current_heatNodes[nodeIdx];
                        if (hn && hn.callsign === callsign) {
                            pilotId = hn.pilot_id;
                            break;
                        }
                    }
                }

                // Add Penalty cell
                var tdPenalty = document.createElement('td');
                tdPenalty.className = 'penalty-cell';
                tdPenalty.style.cssText = 'text-align: center;';
                tdPenalty.innerHTML = '<input type="checkbox" class="udgp-penalty-cb" data-pilot-id="' + (pilotId || '') + '" title="Apply -2 lap penalty">';
                pilotCell.parentNode.insertBefore(tdPenalty, pilotCell.nextSibling);

                // Add DQ cell
                var tdDQ = document.createElement('td');
                tdDQ.className = 'dq-cell';
                tdDQ.style.cssText = 'text-align: center;';
                tdDQ.innerHTML = '<input type="checkbox" class="udgp-dq-cb" data-pilot-id="' + (pilotId || '') + '" title="Disqualified (0 laps)">';
                tdPenalty.parentNode.insertBefore(tdDQ, tdPenalty.nextSibling);
            });

            // Attach event handlers
            table.querySelectorAll('.udgp-penalty-cb').forEach(function(cb) {
                cb.removeEventListener('change', onRunPenaltyChange);
                cb.addEventListener('change', onRunPenaltyChange);
            });
            table.querySelectorAll('.udgp-dq-cb').forEach(function(cb) {
                cb.removeEventListener('change', onRunDQChange);
                cb.addEventListener('change', onRunDQChange);
            });

            updateRunCheckboxes();
        }

        // Observe DOM changes to add columns when leaderboard updates
        var runObserver = new MutationObserver(function(mutations) {
            addColumns();
        });

        var leaderboard = document.querySelector('#leaderboard');
        if (leaderboard) {
            runObserver.observe(leaderboard, {
                childList: true,
                subtree: true
            });
        }

        // Initial setup
        setTimeout(addColumns, 500);

        // Request current state
        socket.emit('get_penalties', { race_id: null });
        socket.emit('get_disqualifications', { race_id: null });

        // Also listen for heat changes to refresh
        socket.on('heat_data', function() {
            setTimeout(function() {
                addColumns();
                socket.emit('get_penalties', { race_id: null });
                socket.emit('get_disqualifications', { race_id: null });
            }, 200);
        });

        // Clear when Discard Laps is clicked
        $('button#discard_laps').on('click', function() {
            penalties = {};
            disqualifications = {};
            updateRunCheckboxes();
        });

        // ========================================
        // Replay functionality
        // ========================================

        // Listen for replay races data
        socket.on('replay_races', function(data) {
            replayHeats = data.heats || [];
            updateReplaySelector();
        });

        socket.on('replay_started', function(data) {
            replayStatus = 'replaying';
            updateReplayUI();
            console.log('UDGP Replay: Started, total laps:', data.total_laps);
        });

        socket.on('replay_error', function(data) {
            // Show error in status field (standard RH way)
            var statusDiv = document.getElementById('udgp-replay-status');
            if (statusDiv) {
                statusDiv.textContent = 'Error: ' + (data.message || 'Unknown error');
                statusDiv.className = 'form-note';
                // Reset after 5 seconds
                setTimeout(function() {
                    replayStatus = 'idle';
                    updateReplayUI();
                }, 5000);
            } else {
                // Fallback to alert if status div not ready
                alert('Replay Error: ' + (data.message || 'Unknown error'));
                replayStatus = 'idle';
            }
        });

        // Request races when page loads
        socket.emit('get_replay_races');

        function updateReplaySelector() {
            var container = document.getElementById('udgp-replay-container');
            if (!container) {
                // Wait for panel to be created
                setTimeout(updateReplaySelector, 200);
                return;
            }

            // Clear existing content
            container.innerHTML = '';

            if (replayHeats.length === 0) {
                var emptyMsg = document.createElement('p');
                emptyMsg.className = 'form-note';
                emptyMsg.textContent = 'No saved races available for replay.';
                container.appendChild(emptyMsg);
                return;
            }

            // Create form structure (standard RH panel format)
            var formEl = document.createElement('ol');
            formEl.className = 'form';

            // Race selector field (wrapped in <li> with label-block)
            var selectorLi = document.createElement('li');

            var labelBlock = document.createElement('div');
            labelBlock.className = 'label-block';

            var selectorLabel = document.createElement('label');
            selectorLabel.setAttribute('for', 'udgp-replay-select');
            selectorLabel.textContent = 'Select Race';
            labelBlock.appendChild(selectorLabel);

            var desc = document.createElement('p');
            desc.className = 'desc';
            desc.textContent = 'Choose a saved race to replay';
            labelBlock.appendChild(desc);

            selectorLi.appendChild(labelBlock);

            var select = document.createElement('select');
            select.id = 'udgp-replay-select';
            select.className = 'set_ui_option';

            var defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = '-- Select Race --';
            select.appendChild(defaultOption);

            // Populate options
            replayHeats.forEach(function(heat) {
                heat.rounds.forEach(function(round) {
                    var option = document.createElement('option');
                    option.value = round.race_id;
                    var label = heat.name + ' - Round ' + round.round_id;
                    if (round.start_time) {
                        label += ' (' + round.start_time + ')';
                    }
                    option.textContent = label;
                    select.appendChild(option);
                });
            });

            selectorLi.appendChild(select);
            formEl.appendChild(selectorLi);

            // Status display (wrapped in <li> with label-block)
            var statusLi = document.createElement('li');

            var statusLabelBlock = document.createElement('div');
            statusLabelBlock.className = 'label-block';

            var statusLabel = document.createElement('label');
            statusLabel.textContent = 'Status';
            statusLabelBlock.appendChild(statusLabel);

            statusLi.appendChild(statusLabelBlock);

            var statusDiv = document.createElement('div');
            statusDiv.id = 'udgp-replay-status';
            statusDiv.className = 'form-note';
            statusDiv.textContent = 'Idle';
            statusLi.appendChild(statusDiv);
            formEl.appendChild(statusLi);

            container.appendChild(formEl);

            // Button set (standard RH format)
            var buttonSet = document.createElement('div');
            buttonSet.className = 'control-set';

            var button = document.createElement('button');
            button.id = 'udgp-replay-start';
            button.className = 'button';
            button.textContent = 'Start Replay';
            button.disabled = true;
            button.onclick = function() {
                var raceId = select.value;
                if (raceId) {
                    replayStatus = 'starting';
                    updateReplayUI();
                    socket.emit('udgp_start_replay', { race_id: parseInt(raceId) });
                }
            };

            buttonSet.appendChild(button);
            container.appendChild(buttonSet);

            // Enable/disable button based on selection
            select.onchange = function() {
                button.disabled = !select.value || replayStatus !== 'idle';
            };

            updateReplayUI();
        }

        function updateReplayUI() {
            var statusDiv = document.getElementById('udgp-replay-status');
            var button = document.getElementById('udgp-replay-start');
            var select = document.getElementById('udgp-replay-select');

            if (statusDiv) {
                var statusText = '';
                switch (replayStatus) {
                    case 'idle':
                        statusText = 'Idle';
                        break;
                    case 'starting':
                        statusText = 'Starting...';
                        break;
                    case 'replaying':
                        statusText = 'Replaying...';
                        break;
                }
                statusDiv.textContent = statusText;
            }

            if (button && select) {
                button.disabled = replayStatus !== 'idle' || !select.value;
            }
        }

        // Reset replay status when race stops
        socket.on('race_status', function(msg) {
            if (msg.race_status === 2) { // Race stopped
                replayStatus = 'idle';
                updateReplayUI();
            }
        });

        // Initial setup
        setTimeout(updateReplaySelector, 500);
    }

    // ========================================
    // Marshal Page
    // ========================================

    if (isMarshalPage) {
        var marshalRaceId = null;

        updateMarshalCheckboxes = function() {
            var penaltyCb = document.getElementById('marshal-penalty-cb');
            var dqCb = document.getElementById('marshal-dq-cb');
            if (!window.current_race_data) return;

            var pilotId = window.current_race_data.pilot_id;
            if (penaltyCb) {
                penaltyCb.checked = pilotId && penalties[pilotId] === true;
            }
            if (dqCb) {
                dqCb.checked = pilotId && disqualifications[pilotId] === true;
            }
        };

        function onMarshalPenaltyChange(e) {
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

        function onMarshalDQChange(e) {
            if (!marshalRaceId || !window.current_race_data) return;

            var pilotId = window.current_race_data.pilot_id;
            if (pilotId) {
                socket.emit('set_disqualification', {
                    race_id: marshalRaceId,
                    pilot_id: pilotId,
                    disqualified: e.target.checked
                });
            }
        }

        // Inject checkboxes into sidebar
        function injectMarshalCheckboxes() {
            var sidebar = document.querySelector('.sidebar-controls');
            if (!sidebar) return;

            // Skip if already injected
            if (document.getElementById('marshal-penalty-cb')) {
                return;
            }

            // Create a section for UDGP controls
            var section = document.createElement('div');
            section.className = 'control-block udgp-section';
            section.innerHTML =
                '<h3>UDGP</h3>' +
                '<label class="udgp-label">' +
                '<input type="checkbox" id="marshal-penalty-cb"> ' +
                '-2 Laps Penalty' +
                '</label>' +
                '<label class="udgp-label udgp-dq-label">' +
                '<input type="checkbox" id="marshal-dq-cb"> ' +
                'Disqualified (DQ)' +
                '</label>';

            // Insert at top of sidebar
            sidebar.insertBefore(section, sidebar.firstChild);

            // Attach event handlers
            var penaltyCb = document.getElementById('marshal-penalty-cb');
            var dqCb = document.getElementById('marshal-dq-cb');
            if (penaltyCb) {
                penaltyCb.addEventListener('change', onMarshalPenaltyChange);
            }
            if (dqCb) {
                dqCb.addEventListener('change', onMarshalDQChange);
            }
        }

        // Listen for pilot selection changes
        $('#selected_pilot').on('change', function () {
            // Wait for current_race_data to be updated
            setTimeout(function () {
                if (window.current_race_data && window.current_race_data.race_id) {
                    marshalRaceId = window.current_race_data.race_id;
                    socket.emit('get_penalties', { race_id: marshalRaceId });
                    socket.emit('get_disqualifications', { race_id: marshalRaceId });
                }
                injectMarshalCheckboxes();
            }, 200);
        });

        // Observe DOM changes
        var marshalObserver = new MutationObserver(function(mutations) {
            injectMarshalCheckboxes();
        });

        var marshalContent = document.querySelector('.page-marshal .panel-content');
        if (marshalContent) {
            marshalObserver.observe(marshalContent, {
                childList: true,
                subtree: true
            });
        }

        // Initial setup
        setTimeout(injectMarshalCheckboxes, 500);
    }

    // ========================================
    // Styles
    // ========================================

    var style = document.createElement('style');
    style.textContent =
        '.penalty-header { background: #fff3cd !important; }' +
        '.dq-header { background: #f8d7da !important; }' +
        '.penalty-cell { background: #fffbf0; }' +
        '.dq-cell { background: #fff5f5; }' +
        '.udgp-penalty-cb, .udgp-dq-cb { width: 18px; height: 18px; cursor: pointer; }' +
        '.udgp-label { display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 8px; }' +
        '.udgp-dq-label { color: #721c24; }' +
        '.udgp-section { margin-bottom: 16px; }';
    document.head.appendChild(style);

    console.log('UDGP: Initialized on', isRunPage ? 'Run' : 'Marshal', 'page');
}
