import { type Scene, ActionManager } from "@babylonjs/core";
import * as GUI from "@babylonjs/gui";
import { InventoryManager, type InventorySlot } from "./InventoryManager";
import { InventoryGridBase } from "./InventoryGridBase";
import { type SlotElements } from "./InventoryUIBase";
import { ItemManager } from "./ItemManager";
import { InputModeManager, InputMode } from "../general/InputModeManager";
import { INVENTORY_GRID_CONSTS } from "./InventoryGridConsts";
import { INVENTORY_SURVIVAL_CONSTS } from "./InventorySurvivalConsts";

export class InventorySurvivalUI extends InventoryGridBase {
  public name = "InventorySurvivalUI";

  private ui = {
    hotbar: {
      container: null as GUI.Grid | null,
      parent: null as GUI.Rectangle | null,
      slots: [] as SlotElements[],
      activeIndex: 0
    },
    storage: {
      container: null as GUI.Grid | null,
      parent: null as GUI.Rectangle | null,
      slots: [] as SlotElements[]
    },
    nameDisplay: null as GUI.TextBlock | null
  };

  private inputHandlers = new Map([
    ['Digit1', () => this.updateActiveSlot(0)],
    ['Digit2', () => this.updateActiveSlot(1)],
    ['Digit3', () => this.updateActiveSlot(2)],
    ['Digit4', () => this.updateActiveSlot(3)],
    ['Digit5', () => this.updateActiveSlot(4)],
    ['Digit6', () => this.updateActiveSlot(5)],
    ['Digit7', () => this.updateActiveSlot(6)],
    ['Digit8', () => this.updateActiveSlot(7)],
    ['Digit9', () => this.updateActiveSlot(8)],
    ['Digit0', () => this.updateActiveSlot(9)],
  ]);

  constructor(scene: Scene) {
    super(scene);
  }

  private highlightSlot(slotIndex: number, color: string): void {
    const elements = this.ui.hotbar.slots[slotIndex];
    if (elements) {
      elements.slotRect.color = color;
    }
  }

  private updateSlot(collectionName: string, slotIndex: number, updateName = false): void {
    if (!InventoryManager.instance) {
      throw new Error("InventoryManager instance not found");
    }
    if (!ItemManager.instance) {
      throw new Error("ItemManager instance not found");
    }

    const slotContents = InventoryManager.instance.getSlotContents(collectionName, slotIndex);
    const elements = collectionName === "hotbar"
      ? this.ui.hotbar.slots[slotIndex]
      : this.ui.storage.slots[slotIndex];

    if (elements) {
      this.updateSlotFromElements(elements, slotContents);
    }

    if (updateName && collectionName === "hotbar" && slotIndex === this.ui.hotbar.activeIndex && this.ui.nameDisplay) {
      if (slotContents) {
        this.ui.nameDisplay.text = ItemManager.instance.getItem(slotContents.itemId).name;
      } else {
        this.ui.nameDisplay.text = "";
      }
    }
  }

  public initialize(): void {
    if (!InventoryManager.instance) {
      throw new Error("InventoryManager instance not found");
    }

    this.createHotbar();
    this.createStorage();
    this.setupToggleControls();
    this.setupDragAndDrop();

    // Trigger initial hotbar selection to slot 0
    this.updateActiveSlot(0);
  }

  public updateHotbarVisibility(): void {
    if (!InputModeManager.instance || !this.ui.hotbar.parent) {
      return;
    }

    const currentMode = InputModeManager.instance.getCurrentMode();
    const shouldBeVisible = currentMode === InputMode.GAMEPLAY || currentMode === InputMode.INVENTORY;

    if (this.ui.hotbar.parent.isVisible !== shouldBeVisible) {
      this.ui.hotbar.parent.isVisible = shouldBeVisible;
    }
  }

  public getCurrentActiveSlotIndex(): number {
    return this.ui.hotbar.activeIndex;
  }

  private createHotbar(): void {
    if (!this.texture) {
      throw new Error("GUI texture must be created before creating hotbar");
    }

    this.ui.hotbar.parent = new GUI.Rectangle("hotbarParent");
    this.ui.hotbar.parent.isPointerBlocker = false;
    this.ui.hotbar.parent.thickness = 0;
    this.ui.hotbar.parent.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.ui.hotbar.parent.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
    this.ui.hotbar.parent.topInPixels = -INVENTORY_SURVIVAL_CONSTS.BOTTOM_OFFSET;
    this.ui.hotbar.parent.widthInPixels = INVENTORY_GRID_CONSTS.SLOT.CONTAINER_SIZE * INVENTORY_SURVIVAL_CONSTS.HOTBAR_SLOTS;
    this.ui.hotbar.parent.heightInPixels = INVENTORY_GRID_CONSTS.SLOT.CONTAINER_SIZE + INVENTORY_SURVIVAL_CONSTS.NAME_DISPLAY.HEIGHT;

    this.texture.addControl(this.ui.hotbar.parent);

    this.createHotbarSlots();
    this.createNameDisplay();
    this.setupHotbarControls();
  }

  private createStorage(): void {
    if (!this.texture) {
      throw new Error("GUI texture must be created before creating storage");
    }

    this.ui.storage.parent = new GUI.Rectangle("storageParent");
    this.ui.storage.parent.isPointerBlocker = false;
    this.ui.storage.parent.thickness = 0;
    this.ui.storage.parent.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.ui.storage.parent.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    this.ui.storage.parent.widthInPixels = INVENTORY_GRID_CONSTS.SLOT.CONTAINER_SIZE * INVENTORY_SURVIVAL_CONSTS.GRID_COLS;
    this.ui.storage.parent.heightInPixels = INVENTORY_GRID_CONSTS.SLOT.CONTAINER_SIZE * (INVENTORY_SURVIVAL_CONSTS.STORAGE_SLOTS / INVENTORY_SURVIVAL_CONSTS.GRID_COLS);
    this.ui.storage.parent.isVisible = false;

    this.texture.addControl(this.ui.storage.parent);

    this.ui.storage.container = this.createGridContainer(INVENTORY_SURVIVAL_CONSTS.STORAGE_SLOTS / INVENTORY_SURVIVAL_CONSTS.GRID_COLS, INVENTORY_SURVIVAL_CONSTS.GRID_COLS);
    this.ui.storage.container.name = "inv_grid";
    this.ui.storage.container.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.ui.storage.container.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;

    this.ui.storage.parent.addControl(this.ui.storage.container);

    this.mainContainer = this.ui.storage.parent;

    for (let i = 0; i < INVENTORY_SURVIVAL_CONSTS.STORAGE_SLOTS; i++) {
      const slotElements = this.createStandardSlot(i);

      this.ui.storage.slots[i] = slotElements;

      this.registerSlot("storage", i, slotElements);

      const row = Math.floor(i / INVENTORY_SURVIVAL_CONSTS.GRID_COLS);
      const col = i % INVENTORY_SURVIVAL_CONSTS.GRID_COLS;
      this.ui.storage.container.addControl(slotElements.slotRect, row, col);
    }
  }

  private createHotbarSlots(): void {
    if (!this.texture) {
      throw new Error("GUI texture must be created before creating hotbar slots");
    }

    this.ui.hotbar.container = this.createGridContainer(1, INVENTORY_SURVIVAL_CONSTS.HOTBAR_SLOTS);
    this.ui.hotbar.container.name = "hotbarContainer";
    this.ui.hotbar.container.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.ui.hotbar.container.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
    this.ui.hotbar.container.heightInPixels = INVENTORY_GRID_CONSTS.SLOT.CONTAINER_SIZE;

    if (this.ui.hotbar.parent) {
      this.ui.hotbar.parent.addControl(this.ui.hotbar.container);
    } else {
      this.texture.addControl(this.ui.hotbar.container);
    }

    for (let i = 0; i < INVENTORY_SURVIVAL_CONSTS.HOTBAR_SLOTS; i++) {
      this.createHotbarSlot(i, ((i + 1) % 10).toString());
    }
  }

  private createHotbarSlot(index: number, slotNumber: string): void {
    if (!this.ui.hotbar.container) {
      throw new Error("HotbarContainer must be created before creating slots");
    }

    const slotElements = this.createStandardSlot(index, slotNumber);

    this.ui.hotbar.slots[index] = slotElements;

    this.registerSlot("hotbar", index, slotElements);

    this.ui.hotbar.container.addControl(slotElements.slotRect, 0, index);
  }

  private createNameDisplay(): void {
    if (!this.texture) {
      throw new Error("GUI texture must be created before creating name display");
    }

    this.ui.nameDisplay = new GUI.TextBlock("hotbarItemName", "");
    this.ui.nameDisplay.color = INVENTORY_SURVIVAL_CONSTS.NAME_DISPLAY.TEXT_COLOR;
    this.ui.nameDisplay.fontSizeInPixels = INVENTORY_SURVIVAL_CONSTS.NAME_DISPLAY.TEXT_SIZE;
    this.ui.nameDisplay.heightInPixels = INVENTORY_SURVIVAL_CONSTS.NAME_DISPLAY.HEIGHT;
    this.ui.nameDisplay.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    this.ui.nameDisplay.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;

    if (this.ui.hotbar.parent) {
      this.ui.hotbar.parent.addControl(this.ui.nameDisplay);
    } else {
      this.texture.addControl(this.ui.nameDisplay);
    }
  }

  private setupHotbarControls(): void {
    if (!InputModeManager.instance) {
      throw new Error("InputModeManager instance not found");
    }

    InputModeManager.instance.registerAction(
      InputMode.GAMEPLAY,
      ActionManager.OnKeyDownTrigger,
      (evt) => {
        const handler = this.inputHandlers.get(evt.sourceEvent.code);
        if (handler) handler();
      },
      this.name
    );
  }

  private updateActiveSlot(newIndex: number): void {
    if (newIndex < 0 || newIndex >= this.ui.hotbar.slots.length) {
      return;
    }

    if (this.ui.hotbar.activeIndex >= 0 && this.ui.hotbar.activeIndex < this.ui.hotbar.slots.length) {
      this.highlightSlot(this.ui.hotbar.activeIndex, INVENTORY_GRID_CONSTS.SLOT.BORDER_COLOR);
    }

    this.ui.hotbar.activeIndex = newIndex;

    this.highlightSlot(this.ui.hotbar.activeIndex, INVENTORY_SURVIVAL_CONSTS.SLOT.HOTBAR_SELECTED_BORDER_COLOR);

    this.updateSlot("hotbar", this.ui.hotbar.activeIndex, true);
  }

  public updateDisplay(_inventory: InventorySlot[]): void {
    if (!this.texture) {
      throw new Error("texture is null in updateDisplay");
    }

    for (let i = 0; i < INVENTORY_SURVIVAL_CONSTS.HOTBAR_SLOTS; i++) {
      this.updateSlot("hotbar", i);
    }
    for (let i = 0; i < INVENTORY_SURVIVAL_CONSTS.STORAGE_SLOTS; i++) {
      this.updateSlot("storage", i);
    }
  }

  public dispose(): void {
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }

    if (InputModeManager.instance) {
      InputModeManager.instance.unregisterActionsForBehavior(this.name);
    }

    this.cleanupDragAndDrop();

    this.ui.storage.container = null;
    this.ui.storage.parent = null;
    this.ui.storage.slots = [];
    this.ui.hotbar.container = null;
    this.ui.hotbar.slots = [];
    this.ui.hotbar.activeIndex = 0;
    this.ui.nameDisplay = null;
    this.ui.hotbar.parent = null;
  }
}
