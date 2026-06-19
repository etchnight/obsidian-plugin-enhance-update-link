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
			this.debugConsole.groupEnd();
			return;
		}
		try {
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
				newHeadings,
			);
			const removedHeadings = this.findChangedHeadings(
				newHeadings,
				oldHeadings,
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
				// 使用局部变量捕获当前状态，避免竞态条件
				const currentOldFile = this.modifiedFiles.oldFile;
				const currentNewFile = this.modifiedFiles.newFile;
				const currentMovedHeadings = this.findMovedHeadings();

				// 立即清空状态，防止后续事件干扰
				this.modifiedFiles.newFile = null;
				this.modifiedFiles.oldFile = null;
				this.movedHeadings.addedHeadings = [];
				this.movedHeadings.removedHeadings = [];
				this.debugConsole.log("所有状态清空");

				if (currentMovedHeadings.length > 0) {
					this.debugConsole.log(
						"移动/修改的标题：",
						currentMovedHeadings,
					);
					//*对所有自动更新都应该关闭触发事件（避免循环触发）
					this.app.vault.off(
						"modify",
						this.handleFileModificationBinded,
					);
					try {
						await this.updateWikiLinks(
							currentMovedHeadings,
							currentOldFile,
							currentNewFile,
						);
						await this.updateTags(
							currentMovedHeadings,
							currentOldFile,
							currentNewFile,
						);
						this.debugConsole.log("更新完成");
					} finally {
						// 确保事件监听器始终被恢复
						this.app.vault.on(
							"modify",
							this.handleFileModificationBinded,
						);
					}
				} else {
					this.debugConsole.log("没有移动/修改的标题,无需更新");
				}
			}
			//* 无论是否更新，新标题增加后，都需要清空状态，以彻底终止此次操作
			/**
			新增标题的情形有：
			- 单纯新增标题，没有移动、修改
			- 新增的标题是由其它位置移动过来的
			- 对原有标题进行修改
			以上情形都标志着对标题修改事件的终结
			*/
			if (addedHeadings.length > 0) {
				this.modifiedFiles.newFile = null;
				this.modifiedFiles.oldFile = null;
				this.movedHeadings.addedHeadings = [];
				this.movedHeadings.removedHeadings = [];
				this.debugConsole.log("所有状态清空");
			}
		} catch (error) {
			this.debugConsole.error("处理文件修改时发生错误:", error);
		} finally {
			this.debugConsole.groupEnd();
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
	 * 默认表示标题增加的情形，即找到从oldHeadings没有，在newHeadings中有的标题
	 * 这仅表示一个文件内标题的增加或删除，移动并没有完成
	 * @param oldHeadings
	 * @param newHeadings
	 * @returns
	 */
	findChangedHeadings(
		oldHeadings: Heading[],
		newHeadings: Heading[],
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
				(h) => h.heading === newHeading.heading,
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
				},
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

	async updateWikiLinks(
		movedHeadings: (Heading & { newHeading: string })[],
		oldFile: TFile,
		newFile: TFile,
	) {
		let count = 0;
		const allFiles = this.app.vault.getMarkdownFiles();
		for (const targetFile of allFiles) {
			// 使用 process 方法的回调函数进行原子性修改，避免覆盖其他修改
			let hasChanges = false;
			await this.app.vault.process(targetFile, (content) => {
				let newContent = content;
				const slash = `\\\\`; //斜杠
				for (const heading of movedHeadings) {
					const linkPattern = new RegExp(
						`\\[\\[${oldFile.basename}#${this.escapeRegExp(
							heading.heading,
						)}(\\|.*?)?\\]\\]`,
						"g",
					);
					//* 为了更新query块
					const linkPattern2 = new RegExp(
						`${slash}\\[${slash}\\[${oldFile.basename}#${this.escapeRegExp(
							heading.heading,
						)}(${slash}\\|.*?)?${slash}\\]${slash}\\]`,
						"g",
					);

					// 直接执行替换，通过比较替换前后内容判断是否有变化
					// 避免使用 test() 导致的 lastIndex 副作用
					const beforeReplace = newContent;
					newContent = newContent.replace(
						linkPattern,
						`[[${newFile.basename}#${heading.newHeading}$1]]`,
					);
					newContent = newContent.replace(
						linkPattern2,
						`\\[\\[${newFile.basename}#${heading.newHeading}$1\\]\\]`,
					);

					if (newContent !== beforeReplace) {
						this.debugConsole.log(
							"找到需要替换的文件",
							targetFile.path,
						);
						hasChanges = true;
					}
				}

				if (hasChanges) {
					new Notice(`${targetFile.path}中链接已更新`);
					count++;
				}

				return newContent;
			});
		}
		//new Notice(`已修改${count}个文件中的wiki链接`);
	}

	/**
	 * 更新基于标题的标签
	 * @param movedHeadings
	 * @param oldFile
	 * @param newFile
	 */
	async updateTags(
		movedHeadings: (Heading & { newHeading: string })[],
		oldFile: TFile,
		newFile: TFile,
	) {
		let count = 0;
		const allFiles = this.app.vault.getMarkdownFiles();
		for (const targetFile of allFiles) {
			// 使用 process 方法的回调函数进行原子性修改，避免覆盖其他修改
			let hasChanges = false;
			await this.app.vault.process(targetFile, (content) => {
				let newContent = content;
				for (const heading of movedHeadings) {
					const prefix = oldFile.path.slice(
						0,
						oldFile.path.lastIndexOf(oldFile.name),
					);
					const tagPattern = new RegExp(
						`#${prefix}(.*?)${this.escapeRegExp(heading.heading)}`,
						"g",
					);

					if (!tagPattern.test(newContent)) {
						continue;
					}

					const newPrefix = newFile.path.slice(
						0,
						newFile.path.lastIndexOf(newFile.name),
					);
					const tag = this.buildTags(newContent, heading.newHeading);

					// 直接执行替换，通过比较替换前后内容判断是否有变化
					// 避免使用 test() 导致的 lastIndex 副作用
					const beforeReplace = newContent;
					newContent = newContent.replace(
						tagPattern,
						`#${newPrefix}${tag}`,
					);

					if (newContent !== beforeReplace) {
						this.debugConsole.log(
							"找到需要替换的文件(标签)",
							targetFile.path,
						);
						hasChanges = true;
					}
				}

				if (hasChanges) {
					new Notice(`${targetFile.path}中标签已更新`);
					count++;
				}

				return newContent;
			});
		}
		//new Notice(`已修改${count}个文件中的wiki链接`);
	}

	escapeRegExp(string: string): string {
		return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	buildTags(content: string, heading: string): string {
		const lines = content.split("\n");

		let targetLevel = -1;
		let tag = heading;
		for (let i = lines.length - 1; i >= 0; i--) {
			const line = lines[i];
			const match = line.match(/^(#+)(\s+)/);
			if (match) {
				const level = match[1].length;
				const spaceLong = match[2].length;
				const title = line.substring(spaceLong + level).trim();
				if (title === heading) {
					targetLevel = level;
				}
				// 找到目标标题之间不进行操作
				if (targetLevel === -1) {
					continue;
				}
				if (level < targetLevel) {
					tag = title + "/" + tag;
					targetLevel = level;
				}
				//一级标题，直接返回
				if (targetLevel === 1) {
					break;
				}
			}
		}

		return tag;
	}
}
