import { Notice, Plugin, TFile, MetadataCache } from "obsidian";

interface Heading {
	heading: string;
	level: number;
	position: number;
	file: TFile;
}

export default class MyPlugin extends Plugin {
	debug = true;
	debugConsole: {
		log: (...args: any) => void;
		warn: (...args: any) => void;
		error: (...args: any) => void;
		group: (...args: any) => void;
		groupEnd: () => void;
	};
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
	handleFileModificationBinded = this.handleFileModification.bind(this);
	async onload() {
		this.metadataCache = this.app.metadataCache;

		//todo 监听变化，改为了手动管理，暂时未发现问题
		//this.registerEvent(
		this.app.vault.on("modify", this.handleFileModificationBinded);
		//);

		if (this.debug) {
			this.debugConsole = console;
		} else {
			this.debugConsole = {
				log: () => {},
				warn: () => {},
				error: () => {},
				group: () => {},
				groupEnd: () => {},
			};
		}
	}

	onunload() {
		this.app.vault.off("modify", this.handleFileModificationBinded);
	}

	async handleFileModification(file: TFile) {
		this.debugConsole.group("文件修改事件");
		this.debugConsole.log("触发文件修改事件", file.path);
		if (file.extension !== "md") {
			return;
		}
		const fileContent = await this.app.vault.read(file);
		const newHeadings = this.extractHeadings(fileContent, file);
		//console.log("newHeadings", newHeadings);
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
		//console.log("oldHeadings", oldHeadings);

		//查找移动的标题并处理
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
			this.debugConsole.log("有标题增加", file.path, addedHeadings);
		}
		if (removedHeadings.length > 0) {
			this.modifiedFiles.oldFile = file;
			this.movedHeadings.removedHeadings = removedHeadings;
			this.debugConsole.log("有标题减少", file.path, removedHeadings);
		}
		//*均有表示有标题移动且已完成
		if (this.modifiedFiles.newFile && this.modifiedFiles.oldFile) {
			const movedHeadings = this.findMovedHeadings();
			if (movedHeadings.length > 0) {
				this.debugConsole.log({ movedHeadings });
				//*对所有自动更新都应该关闭触发事件（避免循环触发）
				this.app.vault.off("modify", this.handleFileModificationBinded);
				await this.updateWikiLinks(movedHeadings);
				this.app.vault.on("modify", this.handleFileModificationBinded);
				//* 移动完成后清空
				this.modifiedFiles.newFile = null;
				this.modifiedFiles.oldFile = null;
				this.movedHeadings.addedHeadings = [];
				this.movedHeadings.removedHeadings = [];
			}
		}
		this.debugConsole.groupEnd();
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
	 * 默认表示标题增加的情形，即找到从oldHeadings没有，在newHeadings中有的标题
	 * 这仅表示一个文件内标题的增加或删除，移动并没有完成
	 * @param oldHeadings
	 * @param newHeadings
	 * @returns
	 */
	findChangedHeadings(
		oldHeadings: Heading[],
		newHeadings: Heading[]
	): Heading[] {
		const movedHeadings: Heading[] = [];
		//console.group("findChangedHeadings");
		//console.log(oldHeadings.map((e) => e.heading));
		//console.log(newHeadings.map((e) => e.heading));
		let oldHeadingsCopy = oldHeadings.map((e) => {
			return { ...e };
		});
		for (const newHeading of newHeadings) {
			//* 排除项
			const unchangedHeadingIndex = oldHeadingsCopy.findIndex(
				(h) => h.heading === newHeading.heading
			);
			if (unchangedHeadingIndex === -1) {
				//console.log("未找到相同标题", newHeading.heading);
				movedHeadings.push(newHeading);
			} else {
				//* 在一篇笔记中可能存在多个相同标题，如果找到一个，那么就移除一个
				oldHeadingsCopy.splice(unchangedHeadingIndex, 1);
				//console.log("找到相同标题", newHeading.heading);
			}
		}
		//console.log(movedHeadings);
		//console.groupEnd();
		return movedHeadings;
	}

	/**
	 * 找到已移动的标题
	 * @returns newFile仅作为调试备用
	 */
	findMovedHeadings(): (Heading & { newHeading: string })[] {
		const movedHeadings: (Heading & { newHeading: string })[] = [];
		for (const addedHeading of this.movedHeadings.addedHeadings) {
			const removedHeading = this.movedHeadings.removedHeadings.find(
				(removedHeading) => {
					if (removedHeading.file.path === addedHeading.file.path) {
						//* 同文件内标题更改但位置不变的算移动
						return (
							removedHeading.position === addedHeading.position &&
							removedHeading.heading !== addedHeading.heading
						);
					} else {
						//* 不同文件标题相同的算移动
						return removedHeading.heading === addedHeading.heading;
					}
				}
			);
			if (removedHeading) {
				movedHeadings.push({
					...removedHeading,
					newHeading: addedHeading.heading,
				});
			}
		}
		return movedHeadings;
	}

	async updateWikiLinks(movedHeadings: (Heading & { newHeading: string })[]) {
		let count = 0;
		const allFiles = this.app.vault.getMarkdownFiles();
		for (const targetFile of allFiles) {
			const content = await this.app.vault.read(targetFile);
			let newContent = content;
			//
			const slash = `\\\\`; //斜杠
			for (const heading of movedHeadings) {
				const linkPattern = new RegExp(
					`\\[\\[${
						(this.modifiedFiles.oldFile as TFile).basename
					}#${this.escapeRegExp(heading.heading)}(\\|.*?)?\\]\\]`,
					"g"
				);
				//* 为了更新query块
				const linkPattern2 = new RegExp(
					`${slash}\\[${slash}\\[${
						(this.modifiedFiles.oldFile as TFile).basename
					}#${this.escapeRegExp(
						heading.heading
					)}(${slash}\\|.*?)?${slash}\\]${slash}\\]`,
					"g"
				);
				if (!linkPattern.test(content) && !linkPattern2.test(content))
					continue;
				this.debugConsole.log("找到需要替换的文件", targetFile.path);
				newContent = newContent.replace(
					linkPattern,
					`[[${(this.modifiedFiles.newFile as TFile).basename}#${
						heading.newHeading
					}$1]]`
				);
				newContent = newContent.replace(
					linkPattern2,
					`\\[\\[${(this.modifiedFiles.newFile as TFile).basename}#${
						heading.newHeading
					}$1\\]\\]`
				);
				count++;
			}

			if (newContent !== content) {
				//* https://docs.obsidian.md/Plugins/Vault#Modify+files
				await this.app.vault.process(targetFile, (data) => {
					return newContent;
				});
			}
		}
		new Notice(`已修改${count}个文件中的wiki链接`);
	}

	escapeRegExp(string: string): string {
		return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
}
