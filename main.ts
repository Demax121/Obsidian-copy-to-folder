import {
	App,
	FuzzySuggestModal,
	Modal,
	Notice,
	Plugin,
	Setting,
	TAbstractFile,
	TFile,
	TFolder,
	normalizePath,
} from "obsidian";

/* ---------- Destination folder picker modal ---------- */

class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
	constructor(
		app: App,
		private source: TAbstractFile,
		private onChoose: (folder: TFolder) => void
	) {
		super(app);
		this.setPlaceholder("Select destination folder…");
	}

	getItems(): TFolder[] {
		const src = this.source;
		return this.app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder)
			.filter((folder) => {
				// don't offer the folder the item already lives in
				if (src.parent && folder.path === src.parent.path) return false;
				// don't copy a folder into itself or into its own subfolders
				if (src instanceof TFolder) {
					if (folder.path === src.path) return false;
					if (folder.path.startsWith(src.path + "/")) return false;
				}
				return true;
			});
	}

	getItemText(folder: TFolder): string {
		return folder.isRoot() ? "/ (vault root)" : folder.path;
	}

	onChooseItem(folder: TFolder): void {
		this.onChoose(folder);
	}
}

/* ---------- Confirmation modal (Promise<boolean>) ---------- */

class ConfirmModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private heading: string,
		private message: string,
		private confirmText: string,
		private resolve: (ok: boolean) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: this.heading });
		contentEl.createEl("p", { text: this.message });

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => this.finish(false))
			)
			.addButton((btn) =>
				btn
					.setButtonText(this.confirmText)
					.setWarning()
					.onClick(() => this.finish(true))
			);
	}

	private finish(ok: boolean): void {
		if (this.resolved) return;
		this.resolved = true;
		this.resolve(ok);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		// closing via Esc / clicking outside the dialog = cancel
		if (!this.resolved) {
			this.resolved = true;
			this.resolve(false);
		}
	}
}

function confirm(
	app: App,
	heading: string,
	message: string,
	confirmText: string
): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmModal(app, heading, message, confirmText, resolve).open();
	});
}

/* ---------- Plugin ---------- */

export default class CopyToFolderPlugin extends Plugin {
	async onload(): Promise<void> {
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (file.path === "/") return; // vault root folder
				menu.addItem((item) =>
					item
						.setTitle("Copy to folder…")
						.setIcon("copy")
						.onClick(() => {
							new FolderSuggestModal(this.app, file, (dest) => {
								void this.copyTo(file, dest);
							}).open();
						})
				);
			})
		);
	}

	private joinPath(folder: TFolder, name: string): string {
		return normalizePath(folder.isRoot() ? name : `${folder.path}/${name}`);
	}

	/** How many files from `src` (recursively) already exist under `destPath`. */
	private countConflicts(src: TAbstractFile, destPath: string): number {
		const vault = this.app.vault;
		if (src instanceof TFile) {
			return vault.getAbstractFileByPath(destPath) instanceof TFile ? 1 : 0;
		}
		let count = 0;
		for (const child of (src as TFolder).children) {
			count += this.countConflicts(
				child,
				normalizePath(`${destPath}/${child.name}`)
			);
		}
		return count;
	}

	private async copyTo(src: TAbstractFile, destFolder: TFolder): Promise<void> {
		const vault = this.app.vault;
		const targetPath = this.joinPath(destFolder, src.name);
		const existing = vault.getAbstractFileByPath(targetPath);
		const isFolder = src instanceof TFolder;
		const label = isFolder ? "Folder" : "File";

		if (existing) {
			if (existing instanceof TFolder !== isFolder) {
				new Notice(
					`Cannot copy: a ${
						existing instanceof TFolder ? "folder" : "file"
					} named "${src.name}" already exists at the destination, but you are copying a ${
						isFolder ? "folder" : "file"
					}.`
				);
				return;
			}

			let details = "The existing file will be overwritten.";
			if (isFolder) {
				const n = this.countConflicts(src, targetPath);
				details =
					`The contents will be merged into the existing folder. ` +
					`Files with the same names (${n}) will be overwritten; ` +
					`other files at the destination will not be changed.`;
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
			if (src instanceof TFile) {
				await this.copyFile(src, targetPath);
			} else {
				await this.copyFolder(src as TFolder, targetPath);
			}
			new Notice(
				`Copied "${src.name}" to ${
					destFolder.isRoot() ? "/" : destFolder.path
				}`
			);
		} catch (err) {
			console.error("[copy-to-folder]", err);
			new Notice(`Copy failed: ${(err as Error).message ?? err}`);
		}
	}

	private async copyFile(src: TFile, destPath: string): Promise<void> {
		const vault = this.app.vault;
		const existing = vault.getAbstractFileByPath(destPath);
		if (existing instanceof TFile) {
			const data = await vault.readBinary(src);
			await vault.modifyBinary(existing, data);
		} else {
			await vault.copy(src, destPath);
		}
	}

	private async copyFolder(src: TFolder, destPath: string): Promise<void> {
		const vault = this.app.vault;
		if (!vault.getAbstractFileByPath(destPath)) {
			await vault.createFolder(destPath);
		}
		for (const child of [...src.children]) {
			const childDest = normalizePath(`${destPath}/${child.name}`);
			if (child instanceof TFile) {
				await this.copyFile(child, childDest);
			} else if (child instanceof TFolder) {
				await this.copyFolder(child, childDest);
			}
		}
	}
}
