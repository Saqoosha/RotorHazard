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

    // Backup replay state
    var backupFiles = [];
    var backupHeats = [];
    var backupReplayStatus = 'idle'; // 'idle', 'loading', 'starting', 'replaying'
    var selectedBackupFile = null;

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

        // Add penalty column to leaderboard
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
            });

            // Attach event handlers
            table.querySelectorAll('.udgp-penalty-cb').forEach(function(cb) {
                cb.removeEventListener('change', onRunPenaltyChange);
                cb.addEventListener('change', onRunPenaltyChange);
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

        // Also listen for heat changes to refresh
        socket.on('heat_data', function() {
            setTimeout(function() {
                addColumns();
                socket.emit('get_penalties', { race_id: null });
            }, 200);
        });

        // Clear when Discard Laps is clicked
        $('button#discard_laps').on('click', function() {
            penalties = {};
            updateRunCheckboxes();
        });

        // ========================================
        // Backup Replay functionality
        // ========================================

        // Listen for backup files list
        socket.on('backup_files_list', function(data) {
            backupFiles = data.files || [];
            updateBackupReplayUI();
        });

        // Listen for backup races data
        socket.on('backup_races_list', function(data) {
            backupHeats = data.heats || [];
            backupReplayStatus = 'idle';
            updateBackupReplayUI();
        });

        socket.on('backup_error', function(data) {
            var statusDiv = document.getElementById('udgp-backup-replay-status');
            if (statusDiv) {
                statusDiv.textContent = 'Error: ' + (data.message || 'Unknown error');
                statusDiv.className = 'form-note';
                setTimeout(function() {
                    backupReplayStatus = 'idle';
                    updateBackupReplayUI();
                }, 5000);
            } else {
                alert('Backup Replay Error: ' + (data.message || 'Unknown error'));
                backupReplayStatus = 'idle';
            }
        });

        // Request backup files when page loads
        socket.emit('get_backup_files');

        function updateBackupReplayUI() {
            var container = document.getElementById('udgp-replay-container');
            if (!container) {
                setTimeout(updateBackupReplayUI, 200);
                return;
            }

            // Find or create backup replay section
            var backupSection = document.getElementById('udgp-backup-replay-section');
            if (!backupSection) {
                // Create backup section
                backupSection = document.createElement('div');
                backupSection.id = 'udgp-backup-replay-section';
                container.appendChild(backupSection);
            }

            // Clear existing content
            backupSection.innerHTML = '';

            // Create form structure
            var formEl = document.createElement('ol');
            formEl.className = 'form';

            // Backup file selector
            var fileSelectorLi = document.createElement('li');
            var fileLabelBlock = document.createElement('div');
            fileLabelBlock.className = 'label-block';

            var fileLabel = document.createElement('label');
            fileLabel.setAttribute('for', 'udgp-backup-file-select');
            fileLabel.textContent = 'Backup File';
            fileLabelBlock.appendChild(fileLabel);

            var fileDesc = document.createElement('p');
            fileDesc.className = 'desc';
            fileDesc.textContent = 'Select a backup database file';
            fileLabelBlock.appendChild(fileDesc);

            fileSelectorLi.appendChild(fileLabelBlock);

            var fileSelect = document.createElement('select');
            fileSelect.id = 'udgp-backup-file-select';

            var defaultFileOption = document.createElement('option');
            defaultFileOption.value = '';
            defaultFileOption.textContent = '-- Select Backup File --';
            fileSelect.appendChild(defaultFileOption);

            backupFiles.forEach(function(file) {
                var option = document.createElement('option');
                option.value = file;
                option.textContent = file;
                if (file === selectedBackupFile) {
                    option.selected = true;
                }
                fileSelect.appendChild(option);
            });

            fileSelect.onchange = function() {
                selectedBackupFile = fileSelect.value;
                if (selectedBackupFile) {
                    backupReplayStatus = 'loading';
                    updateBackupReplayUI();
                    socket.emit('get_backup_races', { backup_file: selectedBackupFile });
                } else {
                    backupHeats = [];
                    updateBackupReplayUI();
                }
            };

            fileSelectorLi.appendChild(fileSelect);
            formEl.appendChild(fileSelectorLi);

            // Race selector (only shown if backup file is selected and races are loaded)
            if (selectedBackupFile && backupHeats.length > 0) {
                var raceSelectorLi = document.createElement('li');
                var raceLabelBlock = document.createElement('div');
                raceLabelBlock.className = 'label-block';

                var raceLabel = document.createElement('label');
                raceLabel.setAttribute('for', 'udgp-backup-race-select');
                raceLabel.textContent = 'Select Race';
                raceLabelBlock.appendChild(raceLabel);

                var raceDesc = document.createElement('p');
                raceDesc.className = 'desc';
                raceDesc.textContent = 'Choose a race from backup to replay';
                raceLabelBlock.appendChild(raceDesc);

                raceSelectorLi.appendChild(raceLabelBlock);

                var raceSelect = document.createElement('select');
                raceSelect.id = 'udgp-backup-race-select';

                var defaultRaceOption = document.createElement('option');
                defaultRaceOption.value = '';
                defaultRaceOption.textContent = '-- Select Race --';
                raceSelect.appendChild(defaultRaceOption);

                backupHeats.forEach(function(heat) {
                    heat.rounds.forEach(function(round) {
                        var option = document.createElement('option');
                        option.value = round.race_id;
                        var label = heat.name + ' - Round ' + round.round_id;
                        if (round.start_time) {
                            label += ' (' + round.start_time + ')';
                        }
                        option.textContent = label;
                        raceSelect.appendChild(option);
                    });
                });

                raceSelectorLi.appendChild(raceSelect);
                formEl.appendChild(raceSelectorLi);

                // Set onchange handler for race selector
                raceSelect.onchange = function() {
                    // Update button state without rebuilding entire UI
                    var button = document.getElementById('udgp-backup-replay-start');
                    if (button) {
                        var canStart = selectedBackupFile && raceSelect.value && backupReplayStatus === 'idle';
                        button.disabled = !canStart;
                    }
                };
            }

            // Status display
            var statusLi = document.createElement('li');
            var statusLabelBlock = document.createElement('div');
            statusLabelBlock.className = 'label-block';

            var statusLabel = document.createElement('label');
            statusLabel.textContent = 'Status';
            statusLabelBlock.appendChild(statusLabel);

            statusLi.appendChild(statusLabelBlock);

            var statusDiv = document.createElement('div');
            statusDiv.id = 'udgp-backup-replay-status';
            statusDiv.className = 'form-note';

            var statusText = '';
            switch (backupReplayStatus) {
                case 'idle':
                    statusText = 'Idle';
                    break;
                case 'loading':
                    statusText = 'Loading races...';
                    break;
                case 'starting':
                    statusText = 'Starting...';
                    break;
                case 'replaying':
                    statusText = 'Replaying...';
                    break;
            }
            statusDiv.textContent = statusText;
            statusLi.appendChild(statusDiv);
            formEl.appendChild(statusLi);

            backupSection.appendChild(formEl);

            // Button set
            var buttonSet = document.createElement('div');
            buttonSet.className = 'control-set';

            var button = document.createElement('button');
            button.id = 'udgp-backup-replay-start';
            button.className = 'button';
            button.textContent = 'Start Replay';

            // Get race select after DOM is updated
            var raceSelect = document.getElementById('udgp-backup-race-select');
            var canStart = selectedBackupFile && raceSelect && raceSelect.value && backupReplayStatus === 'idle';
            button.disabled = !canStart;

            button.onclick = function() {
                var raceSelect = document.getElementById('udgp-backup-race-select');
                if (raceSelect && raceSelect.value) {
                    backupReplayStatus = 'starting';
                    updateBackupReplayUI();
                    socket.emit('start_backup_replay', {
                        backup_file: selectedBackupFile,
                        race_id: parseInt(raceSelect.value)
                    });
                }
            };

            buttonSet.appendChild(button);
            backupSection.appendChild(buttonSet);
        }

        // Handle replay_started for backup replay
        socket.on('replay_started', function(data) {
            if (data.backup_file) {
                backupReplayStatus = 'replaying';
                updateBackupReplayUI();
                console.log('UDGP Replay: Started, total laps:', data.total_laps);
            }
        });

        // Reset backup replay status when race stops
        socket.on('race_status', function(msg) {
            if (msg.race_status === 2) { // Race stopped
                backupReplayStatus = 'idle';
                updateBackupReplayUI();
            }
        });

        // Initial setup
        setTimeout(updateBackupReplayUI, 500);

        // ========================================
        // Web Announcements (AWS Polly TTS)
        // ========================================

        var webAnnounceEnabled = false;
        var audioContext = null;
        var gainNode = null;
        var audioQueue = [];
        var isPlaying = false;
        var preloadedSounds = {};

        // Initialize Web Audio API
        function initAudioContext() {
            if (audioContext) return;
            try {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();

                // Create GainNode for volume control
                gainNode = audioContext.createGain();
                gainNode.connect(audioContext.destination);

                // Load saved volume setting (default: 100 = 1.0)
                var savedVolume = 100;
                if (typeof localStorage !== 'undefined') {
                    var saved = localStorage.getItem('rotorhazard.udgp_web_announce_volume');
                    if (saved !== null) {
                        savedVolume = parseInt(saved, 10);
                        if (isNaN(savedVolume)) savedVolume = 100;
                    }
                }
                // Convert 0-100 to 0-1 for gain value
                gainNode.gain.value = savedVolume / 100;

                console.log('UDGP: AudioContext initialized with volume:', savedVolume);
            } catch (e) {
                console.error('UDGP: Failed to create AudioContext:', e);
            }
        }

        // Preload static sound files
        function preloadSounds() {
            var sounds = ['count', 'go', 'count5', 'p'];
            sounds.forEach(function(name) {
                fetch('/udgp/static/' + name + '.mp3')
                    .then(function(response) { return response.arrayBuffer(); })
                    .then(function(arrayBuffer) {
                        return audioContext.decodeAudioData(arrayBuffer);
                    })
                    .then(function(audioBuffer) {
                        preloadedSounds[name] = audioBuffer;
                        console.log('UDGP: Preloaded sound:', name);
                    })
                    .catch(function(err) {
                        console.warn('UDGP: Failed to preload sound ' + name + ':', err);
                    });
            });
        }

        // Play preloaded sound
        function playPreloadedSound(name) {
            if (!audioContext || !preloadedSounds[name]) {
                console.warn('UDGP: Sound not available:', name);
                return Promise.resolve();
            }
            return new Promise(function(resolve) {
                var source = audioContext.createBufferSource();
                source.buffer = preloadedSounds[name];
                // Connect through gainNode if available, otherwise direct to destination
                if (gainNode) {
                    source.connect(gainNode);
                } else {
                    source.connect(audioContext.destination);
                }
                source.onended = resolve;
                source.start(0);
            });
        }

        // Web Speech API fallback for offline TTS
        function speakWithBrowserTTS(text) {
            return new Promise(function(resolve, reject) {
                if (!window.speechSynthesis) {
                    reject(new Error('Speech synthesis not supported'));
                    return;
                }

                var utterance = new SpeechSynthesisUtterance(text);
                var voices = speechSynthesis.getVoices();
                var selectedVoice = null;

                // Use voice from RH Audio Settings if available
                if (typeof rotorhazard !== 'undefined' && rotorhazard.voice_language) {
                    selectedVoice = voices.find(function (v) {
                        return v.name === rotorhazard.voice_language;
                    });
                    if (selectedVoice) {
                        console.log('UDGP: Using RH selected voice:', selectedVoice.name);
                    }
                }

                // Fallback to Japanese voices if RH voice not set/found
                if (!selectedVoice) {
                    utterance.lang = 'ja-JP';
                    utterance.rate = 1.2; // Slightly faster to match Polly x-fast

                    var preferredVoices = [
                        'Otoya (Enhanced)',
                        'Kyoko (Enhanced)',
                        'Otoya',
                        'Kyoko'
                    ];

                    for (var i = 0; i < preferredVoices.length; i++) {
                        var found = voices.find(function (v) {
                            return v.name === preferredVoices[i];
                        });
                        if (found) {
                            selectedVoice = found;
                            break;
                        }
                    }

                    // Fallback to any Japanese voice
                    if (!selectedVoice) {
                        selectedVoice = voices.find(function (v) {
                            return v.lang.startsWith('ja');
                        });
                    }
                }

                if (selectedVoice) {
                    utterance.voice = selectedVoice;
                    if (!utterance.lang) {
                        console.log('UDGP: Using browser voice:', selectedVoice.name);
                    }
                }

                utterance.onend = resolve;
                utterance.onerror = function(e) {
                    reject(new Error('Speech synthesis error: ' + e.error));
                };

                speechSynthesis.speak(utterance);
            });
        }

        // Fetch TTS audio from server (with timeout)
        function fetchTTSAudio(text) {
            // If offline, fail immediately
            if (!navigator.onLine) {
                return Promise.reject(new Error('Offline'));
            }

            // Use AbortController for 2 second timeout
            var controller = new AbortController();
            var timeoutId = setTimeout(function() { controller.abort(); }, 2000);

            return fetch('/api/tts?text=' + encodeURIComponent(text), {
                signal: controller.signal
            })
                .then(function(response) {
                    clearTimeout(timeoutId);
                    if (!response.ok) {
                        throw new Error('TTS request failed: ' + response.status);
                    }
                    return response.arrayBuffer();
                })
                .then(function(arrayBuffer) {
                    return audioContext.decodeAudioData(arrayBuffer);
                })
                .catch(function(err) {
                    clearTimeout(timeoutId);
                    throw err;
                });
        }

        // Play audio buffer
        function playAudioBuffer(audioBuffer) {
            return new Promise(function(resolve) {
                var source = audioContext.createBufferSource();
                source.buffer = audioBuffer;
                // Connect through gainNode if available, otherwise direct to destination
                if (gainNode) {
                    source.connect(gainNode);
                } else {
                    source.connect(audioContext.destination);
                }
                source.onended = resolve;
                source.start(0);
            });
        }

        // Process audio queue
        function processAudioQueue() {
            if (isPlaying || audioQueue.length === 0) return;
            isPlaying = true;

            var item = audioQueue.shift();
            var playPromise;

            if (item.type === 'preloaded') {
                playPromise = playPreloadedSound(item.name);
            } else if (item.type === 'tts') {
                playPromise = fetchTTSAudio(item.text)
                    .then(function(audioBuffer) {
                        return playAudioBuffer(audioBuffer);
                    })
                    .catch(function(err) {
                        console.warn('UDGP: Polly TTS failed, trying browser fallback:', err);
                        return speakWithBrowserTTS(item.text);
                    });
            } else {
                playPromise = Promise.resolve();
            }

            playPromise.then(function() {
                isPlaying = false;
                processAudioQueue();
            });
        }

        // Queue audio for playback
        function queueAudio(item) {
            audioQueue.push(item);
            processAudioQueue();
        }

        // Handle announce events
        socket.on('udgp_announce', function(data) {
            if (!webAnnounceEnabled) return;

            // Ensure audio context is initialized (needs user interaction first)
            if (!audioContext) {
                initAudioContext();
                if (audioContext) preloadSounds();
            }
            if (!audioContext) return;

            console.log('UDGP: Announce event:', data);

            switch (data.type) {
                case 'countdown_start':
                    // Play countdown beeps followed by TTS
                    queueAudio({ type: 'tts', text: data.text });
                    // Schedule countdown beeps (count.mp3 plays 3-2-1)
                    setTimeout(function() {
                        queueAudio({ type: 'preloaded', name: 'count' });
                    }, 1500);
                    break;

                case 'race_start':
                    // Play GO sound
                    queueAudio({ type: 'preloaded', name: 'go' });
                    break;

                case 'countdown_5sec':
                    // Play last 5 seconds countdown beep
                    playPreloadedSound('count5');
                    break;

                case 'headshot':
                case 'lap':
                    // Play lap beep immediately (can overlap with TTS)
                    playPreloadedSound('p');
                    if (data.text) {
                        queueAudio({ type: 'tts', text: data.text });
                    }
                    break;

                case 'final_lap':
                    // Play TTS only
                    if (data.text) {
                        queueAudio({ type: 'tts', text: data.text });
                    }
                    break;

                case 'goal':
                    // Play lap beep immediately, then TTS
                    playPreloadedSound('p');
                    if (data.text) {
                        queueAudio({ type: 'tts', text: data.text });
                    }
                    break;

                case 'time_remaining':
                    // Play TTS only if not already playing (skip if delayed)
                    if (data.text) {
                        if (isPlaying) {
                            console.log('UDGP: Skipping time_remaining - audio in progress');
                        } else {
                            queueAudio({ type: 'tts', text: data.text });
                        }
                    }
                    break;

                case 'time_elapsed':
                case 'time_up':
                case 'race_results':
                    // Play TTS only
                    if (data.text) {
                        queueAudio({ type: 'tts', text: data.text });
                    }
                    break;

                default:
                    console.log('UDGP: Unknown announce type:', data.type);
            }
        });

        // Enable announcements on user interaction (required for AudioContext)
        function enableWebAnnouncements() {
            webAnnounceEnabled = true;
            initAudioContext();
            if (audioContext) {
                // Resume if suspended (browser autoplay policy)
                if (audioContext.state === 'suspended') {
                    audioContext.resume();
                }
                preloadSounds();
            }
            console.log('UDGP: Web announcements enabled');
        }

        // Check server setting and auto-enable if enabled
        // Note: Still requires user interaction to unlock AudioContext
        document.addEventListener('click', function enableOnFirstClick() {
            enableWebAnnouncements();
            document.removeEventListener('click', enableOnFirstClick);
        }, { once: true });

        // Also try to enable on any audio control interaction
        document.addEventListener('touchstart', function enableOnTouch() {
            enableWebAnnouncements();
            document.removeEventListener('touchstart', enableOnTouch);
        }, { once: true });

        // ========================================
        // Web Announce Volume Control UI
        // ========================================

        // Add volume control UI to Audio Control panel
        function addVolumeControlUI() {
            // Find Audio Control panel
            var panels = document.querySelectorAll('.panel');
            var audioControlPanel = null;
            for (var i = 0; i < panels.length; i++) {
                var header = panels[i].querySelector('.panel-header h2');
                if (header && header.textContent.trim() === 'Audio Control') {
                    audioControlPanel = panels[i];
                    break;
                }
            }

            if (!audioControlPanel) {
                // Panel not found yet, try again later
                setTimeout(addVolumeControlUI, 500);
                return;
            }

            // Check if already added
            if (document.getElementById('set_web_announce_volume')) {
                return;
            }

            // Find the form list (<ol class="form">)
            var formList = audioControlPanel.querySelector('ol.form');
            if (!formList) {
                // Form list not found, try again later
                setTimeout(addVolumeControlUI, 500);
                return;
            }

            // Find Indicator Beeps Volume item to insert after it
            var indicatorVolumeInput = document.getElementById('set_indicator_volume');
            var insertAfter = null;
            if (indicatorVolumeInput) {
                // Find the parent <li> element
                insertAfter = indicatorVolumeInput.closest('li');
            }

            // Create Web Announce Volume control
            var volumeLi = document.createElement('li');

            var labelBlock = document.createElement('div');
            labelBlock.className = 'label-block';

            var label = document.createElement('label');
            label.setAttribute('for', 'set_web_announce_volume');
            label.textContent = 'Web Announce Volume';
            labelBlock.appendChild(label);

            var desc = document.createElement('p');
            desc.className = 'desc';
            desc.innerHTML = 'Volume: <span id="web_announce_volume_value"></span>';
            labelBlock.appendChild(desc);

            volumeLi.appendChild(labelBlock);

            var volumeInput = document.createElement('input');
            volumeInput.type = 'range';
            volumeInput.id = 'set_web_announce_volume';
            volumeInput.min = '0';
            volumeInput.max = '100';
            volumeLi.appendChild(volumeInput);

            // Insert after Indicator Beeps Volume, or at the end if not found
            if (insertAfter && insertAfter.parentNode === formList) {
                formList.insertBefore(volumeLi, insertAfter.nextSibling);
            } else {
                formList.appendChild(volumeLi);
            }

            // Load saved volume setting
            var savedVolume = 100;
            if (typeof localStorage !== 'undefined') {
                var saved = localStorage.getItem('rotorhazard.udgp_web_announce_volume');
                if (saved !== null) {
                    savedVolume = parseInt(saved, 10);
                    if (isNaN(savedVolume)) savedVolume = 100;
                }
            }
            volumeInput.value = savedVolume;
            document.getElementById('web_announce_volume_value').textContent = savedVolume;

            // Update gainNode if audioContext is already initialized
            if (gainNode) {
                gainNode.gain.value = savedVolume / 100;
            }

            // Handle input event (real-time update)
            volumeInput.addEventListener('input', function(event) {
                var volume = parseInt(event.target.value, 10);
                document.getElementById('web_announce_volume_value').textContent = volume;

                // Update gainNode immediately
                if (gainNode) {
                    gainNode.gain.value = volume / 100;
                }
            });

            // Handle change event (save to localStorage)
            volumeInput.addEventListener('change', function(event) {
                var volume = parseInt(event.target.value, 10);

                // Save to localStorage
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem('rotorhazard.udgp_web_announce_volume', volume.toString());
                }

                // Update gainNode
                if (gainNode) {
                    gainNode.gain.value = volume / 100;
                }

                console.log('UDGP: Web announce volume set to:', volume);
            });

            console.log('UDGP: Volume control UI added to Audio Control panel');
        }

        // Initialize volume control UI
        setTimeout(addVolumeControlUI, 500);
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
        '.penalty-cell { background: #fffbf0; }' +
        '.udgp-penalty-cb, .udgp-dq-cb { width: 18px; height: 18px; cursor: pointer; }' +
        '.udgp-label { display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 8px; }' +
        '.udgp-dq-label { color: #721c24; }' +
        '.udgp-section { margin-bottom: 16px; }';
    document.head.appendChild(style);

    console.log('UDGP: Initialized on', isRunPage ? 'Run' : 'Marshal', 'page');
}
