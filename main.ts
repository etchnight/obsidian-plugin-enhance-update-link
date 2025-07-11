import {
	App,
	Editor,
	MarkdownView,
	Menu,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	MetadataCache,
	MarkdownFileInfo,
} from "obsidian";

interface Heading {
	heading: string;
	level: number;
	position: number;
	file: TFile;
}

export default class MyPlugin extends Plugin {
	metadataCache: MetadataCache;
	modifiedFiles: { oldFile: TFile | null; newFile: TFile | null } = {
		oldFile: null,
		newFile: null,
	};
	//removedHeadings对应oldFile，addedHeadings对应newFile
	movedHeadings: { removedHeadings: Heading[]; addedHeadings: Heading[] } = {
		removedHeadings: [],
		addedHeadings: [],
	};
	async onload() {
		this.metadataCache = this.app.metadataCache;

		// Listen for file changes
		this.registerEvent(
			this.app.vault.on("modify", async (file: TFile) => {
				if (file.extension === "md") {
					await this.handleFileModification(file);
				}
			})
		);
	}

	onunload() {}

	async handleFileModification(file: TFile) {
		const fileContent = await this.app.vault.read(file);
		const newHeadings = this.extractHeadings(fileContent, file);
		const oldHeadings = (
			this.metadataCache.getFileCache(file)?.headings || []
		).map((heading) => {
			return {
				heading: heading.heading,
				level: heading.level,
				position: heading.position.start.line,
				file: file,
			};
		});
		// Compare old and new headings to find moved ones
		const addedHeadings = this.findChangedHeadings(
			oldHeadings,
			newHeadings
		);
		const removedHeadings = this.findChangedHeadings(
			newHeadings,
			oldHeadings
		);
		if (addedHeadings.length > 0) {
			this.modifiedFiles.newFile = file;
			this.movedHeadings.addedHeadings = addedHeadings;
		} else if (removedHeadings.length > 0) {
			this.modifiedFiles.oldFile = file;
			this.movedHeadings.removedHeadings = removedHeadings;
		}
		//*均有表示有标题移动且已完成
		if (this.modifiedFiles.newFile && this.modifiedFiles.oldFile) {
			const movedHeadings = this.findMovedHeadings();
			//console.log({ movedHeadings });
			if (movedHeadings.length > 0) {
				await this.updateWikiLinks(movedHeadings);
				//* 移动完成后清空
				this.modifiedFiles.newFile = null;
				this.modifiedFiles.oldFile = null;
				this.movedHeadings.addedHeadings = [];
				this.movedHeadings.removedHeadings = [];
			}
		}
	}

	/**
	 * 提取标题
	 * @param content
	 * @returns
	 */
	extractHeadings(content: string, file: TFile): Heading[] {
		const headings: Heading[] = [];
		const lines = content.split("\n");
		const headingRegex = /^(#{1,6})\s+(.*)$/;

		lines.forEach((line, index) => {
			const match = line.match(headingRegex);
			if (match) {
				headings.push({
					heading: match[2],
					level: match[1].length,
					position: index,
					file: file,
				});
			}
		});
		return headings;
	}

	/**
	 * 找到从oldHeadings没有，在newHeadings中有的标题
	 * 这仅表示标题的增加或删除，移动并没有完成
	 * @param oldHeadings
	 * @param newHeadings
	 * @returns
	 */
	findChangedHeadings(
		oldHeadings: Heading[],
		newHeadings: Heading[]
	): Heading[] {
		const movedHeadings: Heading[] = [];

		newHeadings.forEach((newHeading) => {
			const existHeading = oldHeadings.find(
				(h) => h.heading === newHeading.heading
			);
			if (!existHeading) {
				movedHeadings.push(newHeading);
			}
		});
		return movedHeadings;
	}

	/**
	 * 找到已移动的标题
	 * @returns newFile仅作为调试备用
	 */
	findMovedHeadings(): (Heading & { newFile: TFile })[] {
		const movedHeadings: (Heading & { newFile: TFile })[] = [];
		for (const addedHeading of this.movedHeadings.addedHeadings) {
			const removedHeading = this.movedHeadings.removedHeadings.find(
				(h) => h.heading === addedHeading.heading
			);
			if (removedHeading) {
				movedHeadings.push({
					...removedHeading,
					newFile: addedHeading.file,
				});
			}
		}
		return movedHeadings;
	}

	async updateWikiLinks(movedHeadings: (Heading & { newFile: TFile })[]) {
		let count = 0;
		const allFiles = this.app.vault.getMarkdownFiles();
		for (const targetFile of allFiles) {
			//* 本文件内的引用也要修改
			//if (targetFile.path === file.path) continue;
			const content = await this.app.vault.read(targetFile);
			let newContent = content;

			for (const heading of movedHeadings) {
				const linkPattern = new RegExp(
					`\\[\\[${
						(this.modifiedFiles.oldFile as TFile).basename
					}#${this.escapeRegExp(heading.heading)}\\]\\]`,
					"g"
				);
				if (!linkPattern.test(content)) continue;
				newContent = newContent.replace(
					linkPattern,
					`[[${(this.modifiedFiles.newFile as TFile).basename}#${
						heading.heading
					}]]`
				);
				count++;
			}

			if (newContent !== content) {
				await this.app.vault.modify(targetFile, newContent);
			}
		}
		new Notice(`已修改${count}个文件中的wiki链接`);
	}

	escapeRegExp(string: string): string {
		return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
}
