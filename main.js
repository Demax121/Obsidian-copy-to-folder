var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => CopyToFolderPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var FolderSuggestModal = class extends import_obsidian.FuzzySuggestModal {
  constructor(app, source, onChoose) {
    super(app);
    this.source = source;
    this.onChoose = onChoose;
    this.setPlaceholder("Select destination folder\u2026");
  }
  getItems() {
    const src = this.source;
    return this.app.vault.getAllLoadedFiles().filter((f) => f instanceof import_obsidian.TFolder).filter((folder) => {
      if (src.parent && folder.path === src.parent.path) return false;
      if (src instanceof import_obsidian.TFolder) {
        if (folder.path === src.path) return false;
        if (folder.path.startsWith(src.path + "/")) return false;
      }
      return true;
    });
  }
  getItemText(folder) {
    return folder.isRoot() ? "/ (vault root)" : folder.path;
  }
  onChooseItem(folder) {
    this.onChoose(folder);
  }
};
var ConfirmModal = class extends import_obsidian.Modal {
  constructor(app, heading, message, confirmText, resolve) {
    super(app);
    this.heading = heading;
    this.message = message;
    this.confirmText = confirmText;
    this.resolve = resolve;
    this.resolved = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.heading });
    contentEl.createEl("p", { text: this.message });
    new import_obsidian.Setting(contentEl).addButton(
      (btn) => btn.setButtonText("Cancel").onClick(() => this.finish(false))
    ).addButton(
      (btn) => btn.setButtonText(this.confirmText).setWarning().onClick(() => this.finish(true))
    );
  }
  finish(ok) {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(ok);
    this.close();
  }
  onClose() {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolve(false);
    }
  }
};
function confirm(app, heading, message, confirmText) {
  return new Promise((resolve) => {
    new ConfirmModal(app, heading, message, confirmText, resolve).open();
  });
}
var CopyToFolderPlugin = class extends import_obsidian.Plugin {
  async onload() {
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file.path === "/") return;
        menu.addItem(
          (item) => item.setTitle("Copy to folder\u2026").setIcon("copy").onClick(() => {
            new FolderSuggestModal(this.app, file, (dest) => {
              void this.copyTo(file, dest);
            }).open();
          })
        );
      })
    );
  }
  joinPath(folder, name) {
    return (0, import_obsidian.normalizePath)(folder.isRoot() ? name : `${folder.path}/${name}`);
  }
  /** How many files from `src` (recursively) already exist under `destPath`. */
  countConflicts(src, destPath) {
    const vault = this.app.vault;
    if (src instanceof import_obsidian.TFile) {
      return vault.getAbstractFileByPath(destPath) instanceof import_obsidian.TFile ? 1 : 0;
    }
    let count = 0;
    for (const child of src.children) {
      count += this.countConflicts(
        child,
        (0, import_obsidian.normalizePath)(`${destPath}/${child.name}`)
      );
    }
    return count;
  }
  async copyTo(src, destFolder) {
    var _a;
    const vault = this.app.vault;
    const targetPath = this.joinPath(destFolder, src.name);
    const existing = vault.getAbstractFileByPath(targetPath);
    const isFolder = src instanceof import_obsidian.TFolder;
    const label = isFolder ? "Folder" : "File";
    if (existing) {
      if (existing instanceof import_obsidian.TFolder !== isFolder) {
        new import_obsidian.Notice(
          `Cannot copy: a ${existing instanceof import_obsidian.TFolder ? "folder" : "file"} named "${src.name}" already exists at the destination, but you are copying a ${isFolder ? "folder" : "file"}.`
        );
        return;
      }
      let details = "The existing file will be overwritten.";
      if (isFolder) {
        const n = this.countConflicts(src, targetPath);
        details = `The contents will be merged into the existing folder. Files with the same names (${n}) will be overwritten; other files at the destination will not be changed.`;
      }
      const first = await confirm(
        this.app,
        `${label} already exists`,
        `${label} "${src.name}" already exists at the destination (${targetPath}). ${details} Do you want to continue?`,
        "Overwrite"
      );
      if (!first) return;
      const second = await confirm(
        this.app,
        "Are you sure?",
        `This is the final confirmation. Overwritten data cannot be easily recovered. Overwrite "${targetPath}"?`,
        "Yes, overwrite"
      );
      if (!second) return;
    }
    try {
      if (src instanceof import_obsidian.TFile) {
        await this.copyFile(src, targetPath);
      } else {
        await this.copyFolder(src, targetPath);
      }
      new import_obsidian.Notice(
        `Copied "${src.name}" to ${destFolder.isRoot() ? "/" : destFolder.path}`
      );
    } catch (err) {
      console.error("[copy-to-folder]", err);
      new import_obsidian.Notice(`Copy failed: ${(_a = err.message) != null ? _a : err}`);
    }
  }
  async copyFile(src, destPath) {
    const vault = this.app.vault;
    const existing = vault.getAbstractFileByPath(destPath);
    if (existing instanceof import_obsidian.TFile) {
      const data = await vault.readBinary(src);
      await vault.modifyBinary(existing, data);
    } else {
      await vault.copy(src, destPath);
    }
  }
  async copyFolder(src, destPath) {
    const vault = this.app.vault;
    if (!vault.getAbstractFileByPath(destPath)) {
      await vault.createFolder(destPath);
    }
    for (const child of [...src.children]) {
      const childDest = (0, import_obsidian.normalizePath)(`${destPath}/${child.name}`);
      if (child instanceof import_obsidian.TFile) {
        await this.copyFile(child, childDest);
      } else if (child instanceof import_obsidian.TFolder) {
        await this.copyFolder(child, childDest);
      }
    }
  }
};
