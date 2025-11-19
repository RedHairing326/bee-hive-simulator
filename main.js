// Main entry point for the bee hive simulator

import { Hive } from './hive.js';
import { Renderer } from './renderer.js';
import { getSeason, formatTime, formatDate, isDarkMode } from './utils.js';
import { events, EventNames } from './event-system.js';
import { validateConfig, normalizeConfig } from './config-validator.js';
import { PersistenceManager } from './persistence.js';

/**
 * @class BeeHiveSimulator
 * Main simulator class managing the bee hive simulation
 */
class BeeHiveSimulator {
    constructor() {
        /** @type {Object|null} */
        this.config = null;
        /** @type {Hive|null} */
        this.hive = null;
        /** @type {Renderer|null} */
        this.renderer = null;
        /** @type {HTMLCanvasElement|null} */
        this.canvas = null;
        /** @type {number} */
        this.lastTimestamp = 0;
        /** @type {number} */
        this.timeMultiplier = 1;
        /** @type {Date} */
        this.simulationDate = new Date();
        /** @type {number} */
        this.elapsedSimulationTime = 0; // Track total simulation time in seconds
        /** @type {boolean} */
        this.running = false;
        /** @type {boolean} */
        this.paused = false;
        /** @type {boolean} */
        this.isMobile = false;
        /** @type {boolean} */
        this.performanceMode = false;
        /** @type {boolean} */
        this.isPageVisible = true;
        /** @type {number} */
        this.zoomLevel = 1.0;
        /** @type {{x: number, y: number}} */
        this.panOffset = { x: 0, y: 0 };
        /** @type {boolean} */
        this.isPanning = false;
        /** @type {{x: number, y: number}} */
        this.lastPanPoint = { x: 0, y: 0 };
        /** @type {number} */
        this.lastHUDUpdate = 0;
        /** @type {number} */
        this.lastHUDUpdate = 0;
        /** @type {number} */
        this.lastThemeCheckHour = -1;

        this.persistenceManager = new PersistenceManager();

        // Setup visibility change handler for battery optimization
        this.setupVisibilityHandler();

        this.init().catch(error => {
            console.error('Failed to initialize simulator:', error);
            events.emit(EventNames.SIMULATION_ERROR, error);
            this.showError('Failed to initialize simulator. Please refresh the page.');
        });
    }

    /**
     * Initialize the simulator
     * @returns {Promise<void>}
     */
    async init() {
        try {
            // Load configuration
            await this.loadConfig();

            // Detect mobile and apply mobile settings
            this.isMobile = this.detectMobile();
            this.applyMobileSettings();

            // Setup canvas
            this.canvas = document.getElementById('hiveCanvas');
            if (!this.canvas) {
                throw new Error('Canvas element not found');
            }

            // Create hive and renderer with error handling
            try {
                this.hive = new Hive(this.config);
                this.renderer = new Renderer(this.canvas, this.config);
            } catch (error) {
                console.error('Failed to create hive or renderer:', error);
                throw new Error(`Failed to initialize simulation: ${error.message}`);
                throw new Error(`Failed to initialize simulation: ${error.message}`);
            }

            // Check for saved data
            if (this.persistenceManager.hasSave()) {
                try {
                    const savedData = this.persistenceManager.load();
                    if (savedData) {
                        console.log('Loading saved hive state...');
                        if (this.hive.importData(savedData)) {
                            // Update simulation date from saved state
                            this.simulationDate = this.hive.currentDate;
                            console.log('Hive state loaded successfully.');
                        }
                    }
                } catch (e) {
                    console.error('Error loading saved state:', e);
                }
            }

            // Setup UI
            this.setupUI();

            // Setup auto-save
            this.setupAutoSave();

            // Setup window resize handler
            this.setupResizeHandler();

            // Setup orientation change handler
            this.setupOrientationHandler();

            // Setup mobile gestures
            if (this.isMobile) {
                this.setupMobileGestures();
            }

            // Set initial time
            if (this.config.ui.useCurrentTime) {
                this.simulationDate = new Date();
            }

            // Start simulation
            this.running = true;
            this.lastTimestamp = performance.now();
            events.emit(EventNames.SIMULATION_START);
            requestAnimationFrame((t) => this.gameLoop(t));
        } catch (error) {
            console.error('Initialization error:', error);
            events.emit(EventNames.SIMULATION_ERROR, error);
            throw error;
        }
    }

    /**
     * Setup visibility change handler for battery optimization
     */
    setupVisibilityHandler() {
        // Handle page visibility changes for battery optimization
        document.addEventListener('visibilitychange', () => {
            this.isPageVisible = !document.hidden;

            if (!this.isPageVisible && this.isMobile) {
                // Page hidden on mobile - reduce update frequency
                if (this.config && this.config.ui) {
                    this.config.ui.targetFPS = Math.max(5, (this.config.ui.targetFPS || 30) * 0.2);
                }
            } else if (this.isPageVisible && this.isMobile) {
                // Page visible - restore normal FPS
                if (this.config && this.config.ui && this.config.ui.mobile) {
                    this.config.ui.targetFPS = this.config.ui.mobile.targetFPS || 20;
                }
            }
        });
    }

    detectMobile() {
        // Comprehensive mobile detection
        const userAgent = navigator.userAgent || navigator.vendor || window.opera;

        // Check for mobile devices
        const isMobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());

        // Check for touch support and small screen
        const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        const isSmallScreen = window.innerWidth <= 768;

        return isMobileDevice || (isTouchDevice && isSmallScreen);
    }

    applyMobileSettings() {
        if (this.isMobile && this.config.grid.mobile) {
            // Apply mobile grid configuration
            this.config.grid.columns = this.config.grid.mobile.columns;
            this.config.grid.rows = this.config.grid.mobile.rows;
            this.config.grid.hexSize = this.config.grid.mobile.hexSize;

            // Apply mobile UI configuration
            if (this.config.ui.mobile) {
                this.config.ui.targetFPS = this.config.ui.mobile.targetFPS;
            }

            console.log('Mobile mode enabled:', this.config.grid);
        }
    }

    setupResizeHandler() {
        let resizeTimeout;
        window.addEventListener('resize', () => {
            // Debounce resize events
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (this.renderer) {
                    this.renderer.resize();
                    this.renderer.render(this.hive);
                }
            }, 250);
        });
    }

    setupOrientationHandler() {
        // Handle orientation changes on mobile
        if (this.isMobile) {
            window.addEventListener('orientationchange', () => {
                setTimeout(() => {
                    if (this.renderer) {
                        this.renderer.resize();
                        this.renderer.render(this.hive);
                    }
                }, 100);
            });

            // Also listen to screen orientation API if available
            if (screen.orientation) {
                screen.orientation.addEventListener('change', () => {
                    setTimeout(() => {
                        if (this.renderer) {
                            this.renderer.resize();
                            this.renderer.render(this.hive);
                        }
                    }, 100);
                });
            }
        }
    }

    setupCollapsiblePanels() {
        const panels = document.querySelectorAll('.panel');

        // Helper function to update tab visibility for a specific panel
        const updateTabVisibility = (panel) => {
            const panelId = panel.id;
            const tab = document.getElementById(`${panelId}-tab`);

            if (tab) {
                // Hide tab when panel is expanded (not collapsed) OR pinned
                if (!panel.classList.contains('collapsed') || panel.classList.contains('pinned')) {
                    tab.classList.add('hidden');
                } else {
                    tab.classList.remove('hidden');
                }
            }
        };

        panels.forEach(panel => {
            const pinBtn = panel.querySelector('.pin-btn');
            let hoverTimeout;
            let touchAutoCloseTimeout;
            const AUTO_CLOSE_DELAY = this.config?.ui?.mobile?.autoCollapseDelay || 5000; // 5 seconds default

            // Pin button handler (mouse and touch)
            const handlePinToggle = (e) => {
                e.stopPropagation();
                e.preventDefault();
                panel.classList.toggle('pinned');

                if (panel.classList.contains('pinned')) {
                    panel.classList.remove('collapsed');
                    // Clear auto-close timer when pinned
                    if (touchAutoCloseTimeout) {
                        clearTimeout(touchAutoCloseTimeout);
                        touchAutoCloseTimeout = null;
                    }
                }

                updateTabVisibility(panel);
            };

            if (pinBtn) {
                pinBtn.addEventListener('click', handlePinToggle);
                pinBtn.addEventListener('touchend', handlePinToggle);
            }

            // Hover to expand (only if not pinned)
            panel.addEventListener('mouseenter', () => {
                if (!panel.classList.contains('pinned')) {
                    clearTimeout(hoverTimeout);
                    clearTimeout(touchAutoCloseTimeout);
                    panel.classList.remove('collapsed');
                    updateTabVisibility(panel);
                }
            });

            // Touch to expand (only if not pinned)
            panel.addEventListener('touchstart', (e) => {
                // Stop propagation to prevent document-level touch handler from closing it immediately
                e.stopPropagation();
                if (!panel.classList.contains('pinned')) {
                    clearTimeout(hoverTimeout);
                    clearTimeout(touchAutoCloseTimeout);
                    panel.classList.remove('collapsed');
                    updateTabVisibility(panel);

                    // Auto-close after delay on touch devices
                    if (this.isMobile) {
                        touchAutoCloseTimeout = setTimeout(() => {
                            if (!panel.classList.contains('pinned')) {
                                panel.classList.add('collapsed');
                                updateTabVisibility(panel);
                            }
                            touchAutoCloseTimeout = null;
                        }, AUTO_CLOSE_DELAY);
                    }
                }
            });

            // Keep panel open while touching/interacting with it
            panel.addEventListener('touchmove', (e) => {
                // Reset auto-close timer while user is interacting
                if (touchAutoCloseTimeout && !panel.classList.contains('pinned')) {
                    clearTimeout(touchAutoCloseTimeout);
                    touchAutoCloseTimeout = setTimeout(() => {
                        if (!panel.classList.contains('pinned')) {
                            panel.classList.add('collapsed');
                            updateTabVisibility(panel);
                        }
                        touchAutoCloseTimeout = null;
                    }, AUTO_CLOSE_DELAY);
                }
            });

            // Collapse on leave (only if not pinned)
            panel.addEventListener('mouseleave', () => {
                if (!panel.classList.contains('pinned')) {
                    hoverTimeout = setTimeout(() => {
                        panel.classList.add('collapsed');
                        updateTabVisibility(panel);
                    }, 300); // Small delay before collapsing
                }
            });

            // Initial visibility update
            updateTabVisibility(panel);
        });

        // Close panels when tapping outside (touch devices only)
        document.addEventListener('touchstart', (e) => {
            // Check if touch is outside all panels and tabs
            const touchedPanel = e.target.closest('.panel');
            const touchedTab = e.target.closest('.panel-tab');
            const touchedPinBtn = e.target.closest('.pin-btn');
            const touchedCanvas = e.target.closest('#hiveCanvas') || e.target.closest('#canvas-container');

            // If touched outside panels, tabs, and buttons, collapse all unpinned panels
            // Also close if touching the canvas (main game area)
            if ((!touchedPanel && !touchedTab && !touchedPinBtn) || touchedCanvas) {
                panels.forEach(panel => {
                    if (!panel.classList.contains('pinned')) {
                        panel.classList.add('collapsed');
                        updateTabVisibility(panel);
                    }
                });
            }
        }, { passive: true });

        // Setup panel tabs (clickable indicators)
        const tabs = document.querySelectorAll('.panel-tab');
        const tabAutoCloseTimers = new Map(); // Track auto-close timers for tabs

        tabs.forEach(tab => {
            const panelId = tab.id.replace('-tab', '');
            const panel = document.getElementById(panelId);

            if (panel) {
                // Handler to toggle pin (mouse and touch)
                const handleTabClick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    // Clear any existing auto-close timer
                    if (tabAutoCloseTimers.has(panelId)) {
                        clearTimeout(tabAutoCloseTimers.get(panelId));
                        tabAutoCloseTimers.delete(panelId);
                    }

                    panel.classList.toggle('pinned');
                    if (panel.classList.contains('pinned')) {
                        panel.classList.remove('collapsed');
                    } else {
                        // If unpinning, show panel and set auto-close timer
                        panel.classList.remove('collapsed');
                        if (this.isMobile) {
                            const timer = setTimeout(() => {
                                if (!panel.classList.contains('pinned')) {
                                    panel.classList.add('collapsed');
                                    updateTabVisibility(panel);
                                }
                                tabAutoCloseTimers.delete(panelId);
                            }, this.config?.ui?.mobile?.autoCollapseDelay || 5000);
                            tabAutoCloseTimers.set(panelId, timer);
                        }
                    }
                    updateTabVisibility(panel);
                };

                // Click/tap tab to toggle pin
                tab.addEventListener('click', handleTabClick);
                tab.addEventListener('touchend', handleTabClick);

                // Prevent tab touches from closing panels
                tab.addEventListener('touchstart', (e) => {
                    e.stopPropagation();
                });

                // Hover tab to show panel temporarily
                tab.addEventListener('mouseenter', () => {
                    if (!panel.classList.contains('pinned')) {
                        // Clear auto-close timer when hovering
                        if (tabAutoCloseTimers.has(panelId)) {
                            clearTimeout(tabAutoCloseTimers.get(panelId));
                            tabAutoCloseTimers.delete(panelId);
                        }
                        panel.classList.remove('collapsed');
                        updateTabVisibility(panel);
                    }
                });
            }
        });

        // Setup tooltip positioning for legend items
        const legendItems = document.querySelectorAll('.legend-item');
        legendItems.forEach(item => {
            item.addEventListener('mouseenter', (e) => {
                const tooltip = item.querySelector('.tooltip');
                if (tooltip) {
                    const rect = item.getBoundingClientRect();
                    // Position tooltip to the left of the legend item
                    tooltip.style.left = (rect.left - 230) + 'px'; // 220px width + 10px gap
                    tooltip.style.top = (rect.top + rect.height / 2) + 'px';
                    tooltip.style.transform = 'translateY(-50%)';
                }
            });
        });

        // Setup cell hover tooltip
        this.setupCellTooltip();
        this.setupTouchGestures();

        // Setup Reset Button
        const resetBtn = document.getElementById('reset-hive-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (confirm('Are you sure you want to reset the hive? This will clear your save and restart the simulation.')) {
                    this.persistenceManager.clear();
                    location.reload();
                }
            });
        }
    }

    setupAutoSave() {
        // Auto-save every minute
        setInterval(() => {
            if (this.running && !this.paused && this.hive) {
                this.persistenceManager.save(this.hive);
            }
        }, 60000);

        // Also save on page unload/hide
        window.addEventListener('beforeunload', () => {
            if (this.hive) {
                this.persistenceManager.save(this.hive);
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.hive) {
                this.persistenceManager.save(this.hive);
            }
        });
    }

    setupTouchGestures() {
        if (!this.isMobile) return;

        const canvas = document.getElementById('hiveCanvas');
        if (!canvas) return;

        let lastTap = 0;
        let tapCount = 0;
        const DOUBLE_TAP_DELAY = 300; // milliseconds

        canvas.addEventListener('touchend', (e) => {
            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTap;

            if (tapLength < DOUBLE_TAP_DELAY && tapLength > 0) {
                // Double tap detected
                e.preventDefault();

                // Haptic feedback if supported
                if (navigator.vibrate && this.config?.ui?.mobile?.enableHapticFeedback) {
                    navigator.vibrate(30);
                }

                // Reset viewport zoom (if you've implemented pan/zoom)
                // For now, we'll just collapse all panels
                const panels = document.querySelectorAll('.panel:not(.pinned)');
                panels.forEach(panel => {
                    panel.classList.add('collapsed');
                });

                // Update tab visibility
                this.updateAllTabVisibility();
            }

            lastTap = currentTime;
        });

        // Prevent unwanted zoom gestures on the canvas
        canvas.addEventListener('gesturestart', (e) => {
            e.preventDefault();
        });

        canvas.addEventListener('gesturechange', (e) => {
            e.preventDefault();
        });

        canvas.addEventListener('gestureend', (e) => {
            e.preventDefault();
        });
    }

    /**
     * Setup mobile gestures for zoom and pan
     */
    setupMobileGestures() {
        if (!this.isMobile || !this.canvas) return;

        const canvas = this.canvas;
        let initialDistance = 0;
        let initialZoom = 1.0;
        let touches = [];

        // Pinch to zoom
        canvas.addEventListener('touchstart', (e) => {
            touches = Array.from(e.touches);

            if (touches.length === 2) {
                // Two finger pinch
                const touch1 = touches[0];
                const touch2 = touches[1];
                initialDistance = Math.hypot(
                    touch2.clientX - touch1.clientX,
                    touch2.clientY - touch1.clientY
                );
                initialZoom = this.zoomLevel;
            } else if (touches.length === 1) {
                // Single finger pan
                this.isPanning = true;
                this.lastPanPoint = { x: touches[0].clientX, y: touches[0].clientY };
            }
        }, { passive: true });

        canvas.addEventListener('touchmove', (e) => {
            touches = Array.from(e.touches);

            if (touches.length === 2 && initialDistance > 0) {
                // Pinch zoom
                e.preventDefault();
                const touch1 = touches[0];
                const touch2 = touches[1];
                const currentDistance = Math.hypot(
                    touch2.clientX - touch1.clientX,
                    touch2.clientY - touch1.clientY
                );

                const scale = currentDistance / initialDistance;
                this.zoomLevel = Math.max(0.5, Math.min(3.0, initialZoom * scale));

                // Apply zoom to renderer if it supports it
                if (this.renderer && typeof this.renderer.setZoom === 'function') {
                    this.renderer.setZoom(this.zoomLevel);
                }
            } else if (touches.length === 1 && this.isPanning) {
                // Pan
                const touch = touches[0];
                const deltaX = touch.clientX - this.lastPanPoint.x;
                const deltaY = touch.clientY - this.lastPanPoint.y;

                this.panOffset.x += deltaX;
                this.panOffset.y += deltaY;

                this.lastPanPoint = { x: touch.clientX, y: touch.clientY };

                // Apply pan to renderer if it supports it
                if (this.renderer && typeof this.renderer.setPan === 'function') {
                    this.renderer.setPan(this.panOffset.x, this.panOffset.y);
                }
            }
        }, { passive: false });

        canvas.addEventListener('touchend', (e) => {
            if (e.touches.length === 0) {
                // All touches ended
                this.isPanning = false;
                initialDistance = 0;
                touches = [];
            } else if (e.touches.length === 1) {
                // One touch remaining, switch to pan mode
                this.isPanning = true;
                this.lastPanPoint = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
        }, { passive: true });
    }

    updateAllTabVisibility() {
        const panels = document.querySelectorAll('.panel');
        panels.forEach(panel => {
            const panelId = panel.id;
            const tab = document.getElementById(`${panelId}-tab`);

            if (tab) {
                if (!panel.classList.contains('collapsed') || panel.classList.contains('pinned')) {
                    tab.classList.add('hidden');
                } else {
                    tab.classList.remove('hidden');
                }
            }
        });
    }

    setupCellTooltip() {
        const canvas = document.getElementById('hiveCanvas');
        const tooltip = document.getElementById('cell-tooltip');

        if (!canvas || !tooltip) return;

        // Shared handler for mouse and touch events
        const handlePointerMove = (clientX, clientY) => {
            if (!this.hive || !this.renderer) return;

            const rect = canvas.getBoundingClientRect();

            // Account for canvas scaling
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;

            const mouseX = (clientX - rect.left) * scaleX;
            const mouseY = (clientY - rect.top) * scaleY;

            // Convert pixel coordinates to hex coordinates
            const hexCoords = this.pixelToHex(mouseX, mouseY);

            if (hexCoords) {
                const cell = this.hive.getCell(hexCoords.q, hexCoords.r);

                if (cell) {
                    // Show tooltip with cell info
                    tooltip.innerHTML = this.getCellTooltipContent(cell);
                    tooltip.classList.add('visible');

                    // Position tooltip near pointer (using screen coordinates, not canvas)
                    tooltip.style.left = (clientX + 15) + 'px';
                    tooltip.style.top = (clientY + 15) + 'px';
                    return;
                }
            }

            // Hide tooltip if not over a cell
            tooltip.classList.remove('visible');
        };

        // Mouse events
        canvas.addEventListener('mousemove', (e) => {
            handlePointerMove(e.clientX, e.clientY);
        });

        canvas.addEventListener('mouseleave', () => {
            tooltip.classList.remove('visible');
        });

        // Touch events with long-press support
        let touchStartTime = 0;
        let touchStartX = 0;
        let touchStartY = 0;
        let longPressTimer = null;
        const LONG_PRESS_DURATION = 500; // milliseconds
        const MOVE_THRESHOLD = 10; // pixels

        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length > 0) {
                const touch = e.touches[0];
                touchStartTime = Date.now();
                touchStartX = touch.clientX;
                touchStartY = touch.clientY;

                // Start long-press timer
                longPressTimer = setTimeout(() => {
                    // Long press detected - show tooltip
                    handlePointerMove(touch.clientX, touch.clientY);
                    // Vibrate if supported (optional feedback)
                    if (navigator.vibrate) {
                        navigator.vibrate(50);
                    }
                }, LONG_PRESS_DURATION);
            }
        }, { passive: true });

        canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length > 0) {
                const touch = e.touches[0];

                // Check if finger moved too much (cancel long-press)
                const moveX = Math.abs(touch.clientX - touchStartX);
                const moveY = Math.abs(touch.clientY - touchStartY);
                if (moveX > MOVE_THRESHOLD || moveY > MOVE_THRESHOLD) {
                    if (longPressTimer) {
                        clearTimeout(longPressTimer);
                        longPressTimer = null;
                    }
                }

                // Still update tooltip if already visible
                if (tooltip.classList.contains('visible')) {
                    handlePointerMove(touch.clientX, touch.clientY);
                }
            }
        }, { passive: true });

        canvas.addEventListener('touchend', () => {
            // Clear long-press timer
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }

            // Hide tooltip shortly after touch ends
            setTimeout(() => {
                tooltip.classList.remove('visible');
            }, 2000); // Keep visible for 2 seconds after touch
        }, { passive: true });
    }

    pixelToHex(pixelX, pixelY) {
        if (!this.renderer) return null;

        const hexSize = this.renderer.hexSize;
        const offsetX = this.renderer.offsetX;
        const offsetY = this.renderer.offsetY;

        // Adjust for canvas offset
        const x = pixelX - offsetX;
        const y = pixelY - offsetY;

        const hexWidth = hexSize * 2;
        const hexHeight = hexSize * Math.sqrt(3);

        // Proper pixel-to-hex conversion for offset coordinates
        // First, get approximate column
        const approxCol = Math.round(x / (hexWidth * 0.75));

        // Check nearby columns (current and adjacent)
        const cols = this.config.grid.columns;
        const rows = this.config.grid.rows;
        const candidates = [];

        for (let col = Math.max(0, approxCol - 1); col <= Math.min(cols - 1, approxCol + 1); col++) {
            // For each column, check possible rows
            const yOffset = (col % 2) * (hexHeight / 2);
            const approxRow = Math.round((y - yOffset) / hexHeight);

            for (let row = Math.max(0, approxRow - 1); row <= Math.min(rows - 1, approxRow + 1); row++) {
                // Calculate the center of this hex
                const hexX = col * hexWidth * 0.75;
                const hexY = row * hexHeight + (col % 2) * (hexHeight / 2);

                // Calculate distance from mouse to hex center
                const dx = x - hexX;
                const dy = y - hexY;
                const distance = Math.sqrt(dx * dx + dy * dy);

                // Check if point is actually inside the hexagon
                // Use a tighter bound based on hex geometry
                if (this.isPointInHex(dx, dy, hexSize)) {
                    candidates.push({ q: col, r: row, distance });
                }
            }
        }

        // Return the closest hex that actually contains the point
        if (candidates.length > 0) {
            candidates.sort((a, b) => a.distance - b.distance);
            return { q: candidates[0].q, r: candidates[0].r };
        }

        return null;
    }

    isPointInHex(dx, dy, hexSize) {
        // Check if a point (relative to hex center) is inside a pointy-top hexagon
        // The renderer draws hexagons with vertices at angles 0, π/3, 2π/3, π, 4π/3, 5π/3
        // This creates a pointy-top hexagon (vertices at top and bottom)

        const abs_dx = Math.abs(dx);
        const abs_dy = Math.abs(dy);

        // For a pointy-top hexagon with radius hexSize:
        // - Height: 2 * hexSize (vertices at ±hexSize in y direction)
        // - Width: √3 * hexSize (flat edges at ±√3/2 * hexSize in x direction)

        // Quick bounding box check
        if (abs_dy > hexSize) {
            return false; // Beyond top or bottom vertex
        }
        if (abs_dx > hexSize * Math.sqrt(3) / 2) {
            return false; // Beyond left or right flat edge
        }

        // Check against the angled edges
        // For a pointy-top hexagon, the angled edge constraint is:
        // |x|/√3 + |y| <= hexSize
        return abs_dx / Math.sqrt(3) + abs_dy <= hexSize;
    }

    getCellTooltipContent(cell) {
        const stateName = this.getCellStateName(cell.state);
        const beeCount = cell.occupyingBees ? cell.occupyingBees.length : 0;

        let html = `<div class="cell-tooltip-header">Cell (${cell.q}, ${cell.r})</div>`;
        html += `<div class="cell-tooltip-row"><span class="cell-tooltip-label">State:</span><span class="cell-tooltip-value">${stateName}</span></div>`;

        if (cell.contentAmount > 0) {
            html += `<div class="cell-tooltip-row"><span class="cell-tooltip-label">Amount:</span><span class="cell-tooltip-value">${cell.contentAmount.toFixed(1)}</span></div>`;
        }

        if (cell.developmentTime > 0) {
            const progress = ((cell.developmentTime / cell.maxDevelopmentTime) * 100).toFixed(0);
            html += `<div class="cell-tooltip-row"><span class="cell-tooltip-label">Progress:</span><span class="cell-tooltip-value">${progress}%</span></div>`;
        }

        if (beeCount > 0) {
            html += `<div class="cell-tooltip-row"><span class="cell-tooltip-label">Bees:</span><span class="cell-tooltip-value">${beeCount}</span></div>`;

            // Show bee types
            const queenCount = cell.occupyingBees.filter(b => b.type === 'queen').length;
            const workerCount = cell.occupyingBees.filter(b => b.type === 'worker').length;

            if (queenCount > 0) {
                html += `<div class="cell-tooltip-row"><span class="cell-tooltip-label">  Queen:</span><span class="cell-tooltip-value">${queenCount}</span></div>`;
            }
            if (workerCount > 0) {
                html += `<div class="cell-tooltip-row"><span class="cell-tooltip-label">  Workers:</span><span class="cell-tooltip-value">${workerCount}</span></div>`;
            }
        }

        if (cell.isDirty) {
            html += `<div class="cell-tooltip-row"><span class="cell-tooltip-label">Status:</span><span class="cell-tooltip-value">Dirty</span></div>`;
        }

        if (cell.hasDeadBee()) {
            const deadBeeText = cell.deadBeeCount > 1 ? `${cell.deadBeeCount} Dead Bees` : 'Dead Bee';
            html += `<div class="cell-tooltip-row"><span class="cell-tooltip-label">Status:</span><span class="cell-tooltip-value">${deadBeeText}</span></div>`;
        }

        return html;
    }

    getCellStateName(state) {
        const names = {
            'empty': 'Empty',
            'egg': 'Egg',
            'larvaeHungry': 'Larvae (Hungry)',
            'larvaeFed': 'Larvae (Fed)',
            'cappedBrood': 'Capped Brood',
            'nectar': 'Nectar',
            'honey': 'Honey',
            'honeyComplete': 'Honey (Full)',
            'honeyCapped': 'Capped Honey',
            'pollen': 'Pollen',
            'beeBread': 'Bee Bread',
            'water': 'Water'
        };
        return names[state] || state;
    }

    /**
     * Load and validate configuration
     * @returns {Promise<void>}
     */
    async loadConfig() {
        try {
            // Check cache first (localStorage for network optimization)
            const cachedConfig = this.getCachedConfig();
            if (cachedConfig) {
                // Use cached config but still validate
                const normalizedConfig = normalizeConfig(cachedConfig);
                const validation = validateConfig(normalizedConfig);

                if (validation.valid) {
                    this.config = normalizedConfig;
                    // Still fetch in background to check for updates
                    this.fetchConfigInBackground();
                    return;
                }
            }

            // Fetch config from network
            const response = await fetch('config.json', {
                cache: 'no-cache', // Always check for updates
                headers: {
                    'Cache-Control': 'no-cache'
                }
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch config.json: ${response.status} ${response.statusText}`);
            }

            const rawConfig = await response.json();

            // Cache the config
            this.cacheConfig(rawConfig);

            // Normalize config to fix common issues
            const normalizedConfig = normalizeConfig(rawConfig);

            // Validate configuration
            const validation = validateConfig(normalizedConfig);

            if (!validation.valid) {
                console.error('Configuration validation failed:', validation.errors);
                events.emit(EventNames.ERROR_CONFIG_INVALID, validation.errors);

                // Show warnings but continue with normalized config
                if (validation.warnings.length > 0) {
                    console.warn('Configuration warnings:', validation.warnings);
                }

                // Use normalized config even if invalid (with defaults)
                this.config = normalizedConfig;
            } else {
                this.config = normalizedConfig;

                // Show warnings if any
                if (validation.warnings.length > 0) {
                    console.warn('Configuration warnings:', validation.warnings);
                }
            }

            // Store original colors for toggling
            if (this.config.colors) {
                this.originalColors = {
                    cellStates: { ...this.config.colors.cellStates },
                    bees: { ...this.config.colors.bees },
                    borders: { ...this.config.colors.borders }
                };
            }

            // Apply color blind mode if enabled
            if (this.config.ui && this.config.ui.colorBlindMode && this.config.colors && this.config.colors.colorBlindPalette) {
                this.applyColorBlindPalette();
            }
        } catch (error) {
            console.error('Failed to load config.json:', error);
            events.emit(EventNames.ERROR_CONFIG_INVALID, [error.message]);

            // Use default config if file doesn't exist
            this.config = this.getDefaultConfig();
            console.log('Using default configuration');
        }
    }

    /**
     * Get cached config from localStorage
     * @returns {Object|null}
     */
    getCachedConfig() {
        try {
            const cached = localStorage.getItem('beehive_config');
            if (cached) {
                const parsed = JSON.parse(cached);
                // Check if cache is recent (less than 1 hour old)
                if (parsed.timestamp && (Date.now() - parsed.timestamp) < 3600000) {
                    return parsed.config;
                }
            }
        } catch (error) {
            console.warn('Failed to read cached config:', error);
        }
        return null;
    }

    /**
     * Cache config to localStorage
     * @param {Object} config - Config to cache
     */
    cacheConfig(config) {
        try {
            localStorage.setItem('beehive_config', JSON.stringify({
                config: config,
                timestamp: Date.now()
            }));
        } catch (error) {
            console.warn('Failed to cache config:', error);
        }
    }

    /**
     * Fetch config in background to check for updates
     */
    async fetchConfigInBackground() {
        try {
            const response = await fetch('config.json', {
                cache: 'no-cache',
                headers: {
                    'Cache-Control': 'no-cache'
                }
            });
            if (response.ok) {
                const rawConfig = await response.json();
                // Update cache
                this.cacheConfig(rawConfig);
                // Optionally notify user of config update
                console.log('Config updated in background');
            }
        } catch (error) {
            // Silently fail - we have cached config
            console.debug('Background config fetch failed:', error);
        }
    }

    applyColorBlindPalette() {
        // Replace main color palettes with color blind friendly versions
        if (this.config.colors.colorBlindPalette) {
            this.config.colors.cellStates = { ...this.config.colors.colorBlindPalette.cellStates };
            this.config.colors.bees = { ...this.config.colors.colorBlindPalette.bees };
            this.config.colors.borders = { ...this.config.colors.colorBlindPalette.borders };
        }
    }

    restoreOriginalColors() {
        // Restore original color palette
        if (this.originalColors) {
            this.config.colors.cellStates = { ...this.originalColors.cellStates };
            this.config.colors.bees = { ...this.originalColors.bees };
            this.config.colors.borders = { ...this.originalColors.borders };
        }
    }

    toggleColorBlindMode() {
        if (this.colorBlindMode) {
            this.applyColorBlindPalette();
        } else {
            this.restoreOriginalColors();
        }

        // Update button appearance
        this.updateColorBlindButton();

        // Force re-render to apply new colors
        if (this.renderer && this.hive) {
            this.renderer.render(this.hive);
        }
    }

    updateColorBlindButton() {
        const colorblindToggle = document.getElementById('colorblind-toggle');
        const colorblindStatus = document.getElementById('colorblind-status');

        if (colorblindToggle && colorblindStatus) {
            if (this.colorBlindMode) {
                colorblindToggle.classList.add('active');
                colorblindStatus.textContent = 'ON';
            } else {
                colorblindToggle.classList.remove('active');
                colorblindStatus.textContent = 'OFF';
            }
        }
    }

    getDefaultConfig() {
        // Fallback default configuration
        return {
            grid: { columns: 10, rows: 7, hexSize: 40 },
            colors: {
                cellStates: {
                    empty: "#F5F5DC",
                    egg: "#FFFFFF",
                    larvaeHungry: "#FFE4B5",
                    larvaeFed: "#FFDAB9",
                    cappedBrood: "#D2691E",
                    nectar: "#87CEEB",
                    honey: "#FFD700",
                    honeyComplete: "#FFA500",
                    pollen: "#FFA500",
                    beeBread: "#FF8C00"
                },
                bees: {
                    queen: "#FF1493",
                    workerYoung: "#000000",
                    workerMiddle: "#333333",
                    workerOld: "#666666",
                    workerVeryOld: "#999999"
                },
                borders: { default: "#8B4513", highlight: "#FFB300" }
            },
            simulation: {
                startWithQueen: true,
                initialWorkerCount: 30,
                initialHoneyStores: 15,
                initialPollenStores: 10,
                tickRate: 100,
                queenEggLayingInterval: 20,
                queenFeedingInterval: 30,
                workerForagingDuration: 120,
                workerNurseDuration: 60,
                eggDuration: 3,
                larvaeDuration: 6,
                pupaDuration: 12,
                workerLifespan: 42,
                queenLifespan: 1460
            },
            environment: {
                basePollenRate: 1.0,
                seasonalMultipliers: { spring: 1.5, summer: 2.0, fall: 0.8, winter: 0.1 },
                hourlyActivityMultipliers: {
                    "0": 0.0, "1": 0.0, "2": 0.0, "3": 0.0, "4": 0.0, "5": 0.0,
                    "6": 0.2, "7": 0.5, "8": 0.8, "9": 1.0, "10": 1.2, "11": 1.3,
                    "12": 1.5, "13": 1.5, "14": 1.4, "15": 1.2, "16": 1.0, "17": 0.8,
                    "18": 0.5, "19": 0.2, "20": 0.0, "21": 0.0, "22": 0.0, "23": 0.0
                },
                randomnessRange: 0.2,
                darkModeStartHour: 19,
                darkModeEndHour: 7
            },
            ui: {
                showControls: true,
                showHUD: true,
                showLegend: true,
                defaultTimeMultiplier: 1,
                maxTimeMultiplier: 1000,
                useCurrentTime: true
            },
            advanced: {
                pathfindingEnabled: true,
                workerAgeColorVariation: true,
                agingSlowdownFactor: 0.02,
                foragerDeathChance: 0.01,
                maxBeesPerCell: 1,
                preferEmptyRoutes: true
            }
        };
    }

    setupUI() {
        // Show/hide UI elements based on config
        const controls = document.getElementById('controls');
        const hud = document.getElementById('hud');
        const legend = document.getElementById('legend');

        if (this.config.ui.showControls) {
            controls.classList.add('visible');
        }

        if (!this.config.ui.showHUD) {
            hud.style.display = 'none';
        }

        if (!this.config.ui.showLegend) {
            legend.style.display = 'none';
        }

        // Setup collapsible panels
        this.setupCollapsiblePanels();

        // Setup time multiplier slider
        const multiplierSlider = document.getElementById('time-multiplier');
        const multiplierValue = document.getElementById('multiplier-value');

        if (multiplierSlider) {
            multiplierSlider.max = this.config.ui.maxTimeMultiplier;
            multiplierSlider.value = this.config.ui.defaultTimeMultiplier;
            this.timeMultiplier = this.config.ui.defaultTimeMultiplier;

            multiplierSlider.addEventListener('input', (e) => {
                this.timeMultiplier = parseFloat(e.target.value);
                multiplierValue.textContent = this.timeMultiplier;
                this.updateSpeedPresetButtons();
            });
        }

        // Setup speed preset buttons
        const presetButtons = document.querySelectorAll('.speed-preset-btn');
        presetButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const speed = parseFloat(btn.dataset.speed);
                this.timeMultiplier = speed;
                multiplierSlider.value = speed;
                multiplierValue.textContent = speed;
                this.updateSpeedPresetButtons();
            });

            // Touch support
            btn.addEventListener('touchend', (e) => {
                e.preventDefault();
                const speed = parseFloat(btn.dataset.speed);
                this.timeMultiplier = speed;
                multiplierSlider.value = speed;
                multiplierValue.textContent = speed;
                this.updateSpeedPresetButtons();
            });
        });

        // Initial active state
        this.updateSpeedPresetButtons();

        // Setup start time picker
        const startTimePicker = document.getElementById('start-time');
        if (startTimePicker) {
            // Set to current time
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');

            startTimePicker.value = `${year}-${month}-${day}T${hours}:${minutes}`;

            startTimePicker.addEventListener('change', (e) => {
                const newDate = new Date(e.target.value);
                if (!isNaN(newDate.getTime())) {
                    // Show confirmation dialog
                    const confirmed = confirm(
                        '⚠️ WARNING: Changing the start time will reset the entire hive!\n\n' +
                        'All bees, brood, and stored resources will be lost.\n' +
                        'The simulation will restart from the beginning.\n\n' +
                        'Do you want to continue?'
                    );

                    if (confirmed) {
                        this.resetSimulation(newDate);
                    } else {
                        // Revert the date picker to current simulation date
                        const currentYear = this.simulationDate.getFullYear();
                        const currentMonth = String(this.simulationDate.getMonth() + 1).padStart(2, '0');
                        const currentDay = String(this.simulationDate.getDate()).padStart(2, '0');
                        const currentHours = String(this.simulationDate.getHours()).padStart(2, '0');
                        const currentMinutes = String(this.simulationDate.getMinutes()).padStart(2, '0');

                        startTimePicker.value = `${currentYear}-${currentMonth}-${currentDay}T${currentHours}:${currentMinutes}`;
                    }
                }
            });
        }

        // Setup color blind mode toggle
        const colorblindToggle = document.getElementById('colorblind-toggle');
        const colorblindStatus = document.getElementById('colorblind-status');

        if (colorblindToggle) {
            // Set initial state
            this.colorBlindMode = this.config.ui.colorBlindMode || false;
            this.updateColorBlindButton();

            // Click handler
            colorblindToggle.addEventListener('click', () => {
                this.colorBlindMode = !this.colorBlindMode;
                this.toggleColorBlindMode();
            });

            // Touch support
            colorblindToggle.addEventListener('touchend', (e) => {
                e.preventDefault();
                this.colorBlindMode = !this.colorBlindMode;
                this.toggleColorBlindMode();
            });
        }

        // Setup pause/resume button
        this.setupPauseButton();

        // Setup performance mode toggle (mobile only)
        if (this.isMobile) {
            this.setupPerformanceModeToggle();
        }

        // Update theme based on time
        this.updateTheme();
    }

    /**
     * Setup pause/resume button
     */
    setupPauseButton() {
        // Create pause button if it doesn't exist
        let pauseBtn = document.getElementById('pause-toggle');
        if (!pauseBtn) {
            const controls = document.getElementById('controls');
            if (controls) {
                pauseBtn = document.createElement('button');
                pauseBtn.id = 'pause-toggle';
                pauseBtn.className = 'toggle-btn';
                pauseBtn.innerHTML = '⏸️ Pause';
                pauseBtn.style.marginTop = '10px';
                controls.appendChild(pauseBtn);
            }
        }

        if (pauseBtn) {
            const updateButton = () => {
                pauseBtn.innerHTML = this.paused ? '▶️ Resume' : '⏸️ Pause';
                pauseBtn.classList.toggle('active', this.paused);
            };

            pauseBtn.addEventListener('click', () => {
                this.togglePause();
                updateButton();
            });

            pauseBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                this.togglePause();
                updateButton();
            });

            // Listen to pause/resume events to update button
            events.on(EventNames.SIMULATION_PAUSE, updateButton);
            events.on(EventNames.SIMULATION_RESUME, updateButton);
        }
    }

    /**
     * Setup performance mode toggle for mobile
     */
    setupPerformanceModeToggle() {
        // Create performance mode button if it doesn't exist
        let perfBtn = document.getElementById('performance-toggle');
        if (!perfBtn) {
            const controls = document.getElementById('controls');
            if (controls) {
                perfBtn = document.createElement('button');
                perfBtn.id = 'performance-toggle';
                perfBtn.className = 'toggle-btn';
                perfBtn.innerHTML = '⚡ Performance Mode: <span id="performance-status">OFF</span>';
                perfBtn.style.marginTop = '10px';
                controls.appendChild(perfBtn);
            }
        }

        if (perfBtn) {
            const perfStatus = document.getElementById('performance-status');
            const updateButton = () => {
                if (perfStatus) {
                    perfStatus.textContent = this.performanceMode ? 'ON' : 'OFF';
                }
                perfBtn.classList.toggle('active', this.performanceMode);
            };

            perfBtn.addEventListener('click', () => {
                this.performanceMode = !this.performanceMode;
                if (this.performanceMode) {
                    // Reduce FPS and disable some features
                    if (this.config && this.config.ui) {
                        this.config.ui.targetFPS = Math.max(10, (this.config.ui.targetFPS || 30) * 0.5);
                    }
                } else {
                    // Restore normal FPS
                    if (this.config && this.config.ui && this.config.ui.mobile) {
                        this.config.ui.targetFPS = this.config.ui.mobile.targetFPS || 20;
                    }
                }
                updateButton();
                events.emit(EventNames.UI_MOBILE_MODE_CHANGED, { performanceMode: this.performanceMode });
            });

            perfBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                perfBtn.click();
            });

            updateButton();
        }
    }

    updateTheme() {
        const darkMode = isDarkMode(this.simulationDate, this.config);
        document.body.className = darkMode ? 'dark-mode' : 'light-mode';
    }

    resetSimulation(newStartDate) {
        // Reset simulation time
        this.elapsedSimulationTime = 0;
        this.simulationDate = newStartDate;

        // Recreate the hive from scratch
        this.hive = new Hive(this.config);

        // Update theme for new time
        this.updateTheme();

        // Force immediate render
        this.renderer.render(this.hive);
        this.updateHUD();
    }

    /**
     * Main game loop
     * @param {number} timestamp - Current timestamp
     */
    gameLoop(timestamp) {
        if (!this.running) return;

        try {
            // Skip updates if paused
            if (this.paused) {
                requestAnimationFrame((t) => this.gameLoop(t));
                return;
            }

            // Skip updates if page is hidden and in battery optimization mode
            if (!this.isPageVisible && this.isMobile && this.performanceMode) {
                // Only update every 10th frame when hidden
                if (Math.random() > 0.1) {
                    requestAnimationFrame((t) => this.gameLoop(t));
                    return;
                }
            }

            // FPS throttling for mobile optimization
            const targetFPS = (this.config && this.config.ui) ? (this.config.ui.targetFPS || 30) : 30;
            const targetFrameTime = 1000 / targetFPS;

            if (!this.lastRenderTime) {
                this.lastRenderTime = timestamp;
            }

            const timeSinceLastRender = timestamp - this.lastRenderTime;

            const deltaTime = (timestamp - this.lastTimestamp) / 1000; // Convert to seconds
            this.lastTimestamp = timestamp;

            // Update simulation time
            // deltaTime is in seconds, timeMultiplier accelerates time
            const simulationDelta = deltaTime * this.timeMultiplier;

            // Track total elapsed simulation time
            this.elapsedSimulationTime += simulationDelta;

            // In our simulation, durations in config are in "days"
            // 1 simulation day = 1 day of real time at 1x multiplier
            // We need to convert real seconds to simulation time
            // At 1x: 1 real second = 1 simulation second
            // Convert simulation seconds to milliseconds for date
            const simulationMilliseconds = simulationDelta * 1000;
            this.simulationDate = new Date(this.simulationDate.getTime() + simulationMilliseconds);

            // Always update hive logic with error handling
            if (this.hive) {
                try {
                    this.hive.update(simulationDelta, this.simulationDate);
                } catch (error) {
                    console.error('Error updating hive:', error);
                    events.emit(EventNames.ERROR_SIMULATION_FAILED, error);
                    // Continue running but log the error
                }
            }

            // Only render at target FPS
            if (timeSinceLastRender >= targetFrameTime) {
                this.lastRenderTime = timestamp;

                // Record frame for performance monitoring
                if (this.hive && this.hive.performanceMonitor) {
                    this.hive.performanceMonitor.recordFrame();
                }

                // Render with error handling
                if (this.renderer && this.hive) {
                    try {
                        this.renderer.render(this.hive);
                    } catch (error) {
                        console.error('Error rendering:', error);
                        events.emit(EventNames.ERROR_RENDER_FAILED, error);
                    }
                }

                // Update HUD (throttle to reduce DOM updates)
                if (!this.lastHUDUpdate || (timestamp - this.lastHUDUpdate) >= 100) {
                    // Update HUD at most 10 times per second
                    try {
                        this.updateHUD();
                        this.lastHUDUpdate = timestamp;
                    } catch (error) {
                        console.error('Error updating HUD:', error);
                    }
                }

                // Update theme (only when needed)
                const currentHour = this.simulationDate.getHours();
                if (this.lastThemeCheckHour !== currentHour) {
                    try {
                        this.updateTheme();
                        this.lastThemeCheckHour = currentHour;
                    } catch (error) {
                        console.error('Error updating theme:', error);
                    }
                }
            }
        } catch (error) {
            console.error('Critical error in game loop:', error);
            events.emit(EventNames.SIMULATION_ERROR, error);
            // Continue loop to prevent complete freeze
        }

        // Continue loop
        requestAnimationFrame((t) => this.gameLoop(t));
    }

    /**
     * Pause the simulation
     */
    pause() {
        if (!this.paused) {
            this.paused = true;
            events.emit(EventNames.SIMULATION_PAUSE);
        }
    }

    /**
     * Resume the simulation
     */
    resume() {
        if (this.paused) {
            this.paused = false;
            this.lastTimestamp = performance.now();
            events.emit(EventNames.SIMULATION_RESUME);
        }
    }

    /**
     * Toggle pause/resume
     */
    togglePause() {
        if (this.paused) {
            this.resume();
        } else {
            this.pause();
        }
    }

    /**
     * Show error message to user
     * @param {string} message - Error message
     */
    showError(message) {
        // Create or update error display
        let errorDiv = document.getElementById('error-message');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.id = 'error-message';
            errorDiv.style.cssText = `
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(255, 0, 0, 0.9);
                color: white;
                padding: 15px 20px;
                border-radius: 8px;
                z-index: 10000;
                max-width: 80%;
                text-align: center;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            `;
            document.body.appendChild(errorDiv);
        }
        errorDiv.textContent = message;

        // Auto-hide after 5 seconds
        setTimeout(() => {
            if (errorDiv && errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 5000);
    }

    updateHUD() {
        const stats = this.hive.getStats();
        const season = getSeason(this.simulationDate);

        // Format elapsed simulation time
        const totalSeconds = Math.floor(this.elapsedSimulationTime);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        let simTimeStr = '';
        if (days > 0) {
            simTimeStr = `${days}d ${hours}h ${minutes}m`;
        } else if (hours > 0) {
            simTimeStr = `${hours}h ${minutes}m ${seconds}s`;
        } else if (minutes > 0) {
            simTimeStr = `${minutes}m ${seconds}s`;
        } else {
            simTimeStr = `${seconds}s`;
        }

        document.getElementById('stat-population').textContent = stats.population;
        document.getElementById('stat-brood').textContent = stats.brood;
        document.getElementById('stat-honey').textContent = stats.honey;
        document.getElementById('stat-pollen').textContent = stats.pollen;
        document.getElementById('stat-water').textContent = stats.water;
        document.getElementById('stat-inside').textContent = stats.beesInside;
        document.getElementById('stat-outside').textContent = stats.beesOutside;
        document.getElementById('stat-foraging-rate').textContent = stats.foragingRate;
        document.getElementById('stat-sim-time').textContent = simTimeStr;
        document.getElementById('stat-time').textContent = formatTime(this.simulationDate);
        document.getElementById('stat-date').textContent = formatDate(this.simulationDate);
        document.getElementById('stat-season').textContent = season.charAt(0).toUpperCase() + season.slice(1);

        // Queen stats
        if (stats.queenAge > 0) {
            const queenAgeDays = Math.floor(stats.queenAge / 86400);
            const queenLifespanDays = Math.floor(stats.queenMaxAge / 86400);
            const queenLifespanPercent = ((stats.queenAge / stats.queenMaxAge) * 100).toFixed(1);

            document.getElementById('stat-queen-age').textContent = `${queenAgeDays} days`;
            document.getElementById('stat-queen-lifespan').textContent = `${queenLifespanPercent}% (${queenLifespanDays} days total)`;
            document.getElementById('stat-queen-eggs-total').textContent = stats.queenEggsTotal;
            document.getElementById('stat-queen-eggs-hour').textContent = stats.queenEggsHour;
            document.getElementById('stat-queen-task').textContent = stats.queenTask;
        } else {
            document.getElementById('stat-queen-age').textContent = 'No Queen';
            document.getElementById('stat-queen-lifespan').textContent = '---';
            document.getElementById('stat-queen-eggs-total').textContent = '---';
            document.getElementById('stat-queen-eggs-hour').textContent = '---';
            document.getElementById('stat-queen-task').textContent = '---';
        }

        // Display today's summary
        if (stats.currentDaySummary) {
            document.getElementById('stat-today-eggs').textContent = stats.currentDaySummary.eggsLaid;
            document.getElementById('stat-today-hatched').textContent = stats.currentDaySummary.beesHatched;
            document.getElementById('stat-today-died').textContent = stats.currentDaySummary.beesDied;
            document.getElementById('stat-today-nectar').textContent = stats.currentDaySummary.nectarCollected;
            document.getElementById('stat-today-pollen').textContent = stats.currentDaySummary.pollenCollected;
            document.getElementById('stat-today-water').textContent = stats.currentDaySummary.waterCollected;
        }

        // Display version
        document.getElementById('stat-version').textContent = this.config.version || '1.0.0';
    }

    updateSpeedPresetButtons() {
        const presetButtons = document.querySelectorAll('.speed-preset-btn');
        presetButtons.forEach(btn => {
            const speed = parseFloat(btn.dataset.speed);
            if (speed === this.timeMultiplier) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }
}

// Start the simulator when the page loads
window.addEventListener('DOMContentLoaded', () => {
    new BeeHiveSimulator();
});

