import { type Scene, ActionManager } from "@babylonjs/core";
import * as GUI from "@babylonjs/gui";
import { type InventorySlot, type InventoryItem } from "./InventoryManager";
import { InventoryManager } from "./InventoryManager";
import { ItemManager } from "./ItemManager";
import { InputModeManager, InputMode } from "../general/InputModeManager";

export interface SlotElements {
    slotRect: GUI.Rectangle;
    itemImage: GUI.Image;
    countText: GUI.TextBlock;
    slotNumber?: GUI.TextBlock;
}

export abstract class InventoryUIBase {
  public name = "InventoryUIBase";

  protected scene: Scene;
  protected texture: GUI.AdvancedDynamicTexture | null = null;

  protected isOpen = false;
  protected mainContainer: GUI.Control | null = null;

  protected constructor(scene: Scene) {
    this.scene = scene;
    this.createTexture();
  }

    public abstract updateDisplay(inventory: InventorySlot[]): void;

    public abstract dispose(): void;

    public abstract initialize(): void;

    protected setupToggleControls(): void {
    	if (!InputModeManager.instance) {
    		throw new Error("InputModeManager instance not found");
    	}

    	InputModeManager.instance.registerAction(
    		InputMode.GAMEPLAY,
    		ActionManager.OnKeyDownTrigger,
    		(evt) => {
    			if (evt.sourceEvent.code === InventoryManager.toggleKey) {
    				this.toggleOpen();
    			}
    		},
    		this.name
    	);

    	InputModeManager.instance.registerAction(
    		InputMode.INVENTORY,
    		ActionManager.OnKeyDownTrigger,
    		(evt) => {
    			if (evt.sourceEvent.code === InventoryManager.toggleKey) {
    				this.toggleOpen();
    			}
    		},
    		this.name
    	);
    }

    protected toggleOpen(): void {
    	if (!InputModeManager.instance) {
    		throw new Error("InputModeManager instance not found");
    	}
    	if (!InventoryManager.instance) {
    		throw new Error("InventoryManager instance not found");
    	}
    	if (!this.mainContainer) {
    		throw new Error("mainContainer must be set before calling toggleOpen");
    	}

    	this.isOpen = !this.isOpen;
    	this.mainContainer.isVisible = this.isOpen;

    	InputModeManager.instance.switchTo(
    		this.isOpen ? InputMode.INVENTORY : InputMode.GAMEPLAY
    	);

    	if (this.isOpen) {
    		this.updateDisplay(InventoryManager.instance.getAllSlots());
    	}
    }

    protected createGridContainer(rows: number, cols: number): GUI.Grid {
    	const grid = new GUI.Grid("grid_container");
    	for (let c = 0; c < cols; c++) {
    		grid.addColumnDefinition(1 / cols);
    	}
    	for (let r = 0; r < rows; r++) {
    		grid.addRowDefinition(1 / rows);
    	}
    	return grid;
    }

    protected updateSlotFromElements(elements: SlotElements, item: InventoryItem | null): void {
    	if (!ItemManager.instance) {
    		throw new Error("ItemManager instance not found");
    	}

    	if (item) {
    		// Image
    		const definition = ItemManager.instance.getItem(item.itemId);
    		elements.itemImage.source = definition.image;
    		elements.itemImage.isVisible = true;

    		// Stack size
    		if (item.currentStackSize > 1) {
    			elements.countText.text = String(item.currentStackSize);
    			elements.countText.isVisible = true;
    		} else {
    			elements.countText.isVisible = false;
    		}
    	} else {
    		elements.itemImage.isVisible = false;
    		elements.countText.isVisible = false;
    	}
    }

    protected createTexture(): void {
    	this.texture = GUI.AdvancedDynamicTexture.CreateFullscreenUI("inventoryUI");
    	this.texture.idealWidth = 1920;
    	this.texture.idealHeight = 1080;
    }
}
