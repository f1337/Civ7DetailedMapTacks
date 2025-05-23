
import { Audio } from '/core/ui/audio-base/audio-support.js';
import ChoosePlotInterfaceMode from '/base-standard/ui/interface-modes/interface-mode-choose-plot.js';
import { InterfaceMode, InterfaceModeChangedEventName } from '/core/ui/interface-modes/interface-modes.js';
import { MustGetElement } from '/core/ui/utilities/utilities-dom.js';
import { PlotCursorUpdatedEventName } from '/core/ui/input/plot-cursor.js';
import LensManager from '/core/ui/lenses/lens-manager.js';
import MapTackUtils from '../map-tack-core/dmt-map-tack-utils.js';
import MapTackValidator from '../map-tack-core/dmt-map-tack-validator.js';
import MapTackYield from '../map-tack-core/dmt-map-tack-yield.js';
import { OVERLAY_PRIORITY } from '/base-standard/ui/utilities/utilities-overlay.js';

const CLEAR_BORDER_OVERLAY_STYLE = {
    style: "CommanderRadius",
    primaryColor: Color.convertToLinear([255, 255, 255, 255])
};
/**
 * Handler for DMT_INTERFACEMODE_PLACE_MAP_TACKS.
 */
class PlaceMapTacksInterfaceMode extends ChoosePlotInterfaceMode {
    constructor() {
        super(...arguments);
        this.lastHoveredPlot = -1;
        this.isCityCenter = false;
        this.clearBorderOverlayGroup = null;

        this.validStatus = {};
        this.yieldDetails = {};

        this.plotCursorUpdatedListener = this.onPlotCursorUpdated.bind(this);
        this.interfaceModeChangedListener = this.onInterfaceModeChanged.bind(this);
    }
    initialize() {
        this.itemType = this.Context.type;
        this.isCityCenter = MapTackUtils.isCityCenter(this.itemType);
        if (this.isCityCenter) {
            this.clearBorderOverlayGroup = WorldUI.createOverlayGroup("ClearCityCenterBorderOverlayGroup", OVERLAY_PRIORITY.CULTURE_BORDER);
        }
        return true;
    }
    reset() {
        this.validStatus = {};
        this.yieldDetails = {};
    }
    transitionTo(oldMode, newMode, context) {
        super.transitionTo(oldMode, newMode, context);
        // Lock out automatic cursor changes
        UI.lockCursor(true);
        // Set the building placement cursor
        UI.setCursorByURL("fs://game/core/ui/cursors/place.ani");
        this.lastHoveredPlot = -1;
        window.addEventListener(PlotCursorUpdatedEventName, this.plotCursorUpdatedListener);
        window.addEventListener(InterfaceModeChangedEventName, this.interfaceModeChangedListener);
        WorldUI.setUnitVisibility(false);
        Input.setActiveContext(InputContext.World);
        // Enable/Disable settler lens depends on the map tack.
        if (MapTackUtils.isCityCenter(this.itemType)) {
            LensManager.enableLayer("fxs-appeal-layer");
            LensManager.enableLayer("fxs-settlement-recommendations-layer");
            LensManager.enableLayer("fxs-random-events-layer");
        }
    }
    transitionFrom(oldMode, newMode) {
        this.clearBorderOverlayGroup?.clearAll();
        LensManager.disableLayer("fxs-appeal-layer");
        LensManager.disableLayer("fxs-settlement-recommendations-layer");
        LensManager.disableLayer("fxs-random-events-layer");
        window.removeEventListener(PlotCursorUpdatedEventName, this.plotCursorUpdatedListener);
        window.removeEventListener(InterfaceModeChangedEventName, this.interfaceModeChangedListener);
        WorldUI.setUnitVisibility(true);
        UI.lockCursor(false);
        super.transitionFrom(oldMode, newMode);
    }
    onInterfaceModeChanged() {
        // Currently in this mode.
        if (InterfaceMode.getCurrent() == "DMT_INTERFACEMODE_PLACE_MAP_TACKS") {
            // Push the chooser to an element under "placement" template screen. Use parent of panel-place-building.
            this.panel = document.querySelector("dmt-panel-place-map-tack");
            if (!this.panel) {
                const parentElement = MustGetElement(".panel-place-building").parentElement;
                this.panel = document.createElement("dmt-panel-place-map-tack");
                parentElement.appendChild(this.panel);
            }
            this.panel.setAttribute("item-type", this.itemType);
        }
    }
    onPlotCursorUpdated(event) {
        this.onPlotUpdated(event.detail.plotCoords);
    }
    onPlotUpdated(plot) {
        if (plot) {
            const plotIndex = GameplayMap.getIndexFromLocation(plot);
            if (plotIndex != this.lastHoveredPlot) {
                this.lastHoveredPlot = plotIndex;
                // Valid status
                this.validStatus = MapTackValidator.isValid(plot.x, plot.y, this.itemType);
                if (this.validStatus.preventPlacement) {
                    UI.setCursorByURL("fs://game/core/ui/cursors/cantplace.ani");
                    // Skip calculating yields if the map tack cannot be placed.
                    this.yieldDetails = {};
                }
                else {
                    UI.setCursorByURL("fs://game/core/ui/cursors/place.ani");
                    // Yields
                    this.yieldDetails = MapTackYield.getYieldDetails(plot.x, plot.y, this.itemType);
                }
                this.updatePlacementDetails();
                // Update city center border overlay if needed.
                if (this.isCityCenter) {
                    this.updateCityCenterBorderOverlay(plot);
                }
            }
        }
    }
    updatePlacementDetails() {
        if (!this.panel) {
            return;
        }
        const placementDetails = {
            validStatus: this.validStatus,
            yieldDetails: this.yieldDetails
        };
        // Following same pattern as tree's unlock-by-depth but using attributes is not ideal for passing large payload.
        this.panel.setAttribute("placement-details", JSON.stringify(placementDetails));
    }
    updateCityCenterBorderOverlay(plot) {
        if (this.clearBorderOverlayGroup) {
            this.clearBorderOverlayGroup.clearAll();
            const cityPlotIndices = GameplayMap.getPlotIndicesInRadius(plot.x, plot.y, 3);
            const clearBorderOverlay = this.clearBorderOverlayGroup.addBorderOverlay(CLEAR_BORDER_OVERLAY_STYLE);
            clearBorderOverlay.setPlotGroups(cityPlotIndices, 0);
        }
    }
    selectPlot(plot, _previousPlot) {
        if (this.isPlotProposed) {
            throw new Error("A plot is already being proposed.");
        }
        this.isPlotProposed = true;
        this.proposePlot(plot, () => {
            this.commitPlot(plot);
            Audio.playSound("data-audio-city-production-placement-activate", "city-actions");
            InterfaceMode.switchTo("DMT_INTERFACEMODE_MAP_TACK_CHOOSER");
        }, () => this.isPlotProposed = false);
        return false;
    }
    proposePlot(_plot, accept, reject) {
        if (this.validStatus.preventPlacement) {
            reject();
        }
        else {
            accept();
        }
    }
    commitPlot(plot) {
        const mapTackData = {
            x: plot.x,
            y: plot.y,
            type: this.itemType,
            classType: MapTackUtils.getConstructibleClassType(this.itemType),
            validStatus: this.validStatus,
            yieldDetails: this.yieldDetails
        };
        engine.trigger("AddMapTackRequest", mapTackData);
    }
    handleInput(inputEvent) {
        if (inputEvent.detail.status != InputActionStatuses.FINISH) {
            return true;
        }
        if (inputEvent.isCancelInput() || inputEvent.detail.name == 'sys-menu') {
            InterfaceMode.switchTo("DMT_INTERFACEMODE_MAP_TACK_CHOOSER");
            inputEvent.stopPropagation();
            inputEvent.preventDefault();
            return false;
        }
        return true;
    }
}
InterfaceMode.addHandler('DMT_INTERFACEMODE_PLACE_MAP_TACKS', new PlaceMapTacksInterfaceMode());