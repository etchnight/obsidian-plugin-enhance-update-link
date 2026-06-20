import { TFile } from "obsidian";

/**
 * 日志配置接口
 */
export interface LogConfig {
	enabled: boolean; // 是否启用文件日志
	logPath: string; // 日志文件路径（相对于库根目录）
	maxLogSize: number; // 最大日志文件大小（字节），超过则归档
	consoleOutput: boolean; // 是否输出到控制台
}

/**
 * 日志条目类型
 */
export type LogType = 'link' | 'tag' | 'error' | 'info';

/**
 * 日志条目接口
 */
export interface LogEntry {
	type: LogType;
	timestamp: string;
	message: string;
	details?: Record<string, any>;
}

/**
 * 日志类
 * 负责将插件操作记录持久化到 Markdown 文件
 */
export class Logger {
	private app: any;
	private logConfig: LogConfig;
	private debugConsole: {
		log: (...args: any) => void;
		error: (...args: any) => void;
	};

	constructor(app: any, logConfig: LogConfig, debugConsole?: { log: (...args: any) => void; error: (...args: any) => void }) {
		this.app = app;
		this.logConfig = logConfig;
		this.debugConsole = debugConsole || {
			log: console.log,
			error: console.error,
		};
	}

	/**
	 * 更新日志配置
	 */
	updateConfig(config: Partial<LogConfig>) {
		this.logConfig = { ...this.logConfig, ...config };
	}

	/**
	 * 写入日志到 Markdown 文件
	 */
	async writeLog(entry: LogEntry) {
		if (!this.logConfig.enabled) return;

		try {
			const logFile = this.app.vault.getAbstractFileByPath(this.logConfig.logPath);
			let content = "";

			// 检查日志文件是否存在
			if (logFile instanceof TFile) {
				content = await this.app.vault.read(logFile);

				// 检查日志文件大小，超过限制则归档
				if (content.length > this.logConfig.maxLogSize) {
					await this.archiveLogFile();
					content = "";
				}
			} else {
				// 创建日志文件和目录
				const dir = this.logConfig.logPath.substring(0, this.logConfig.logPath.lastIndexOf('/'));
				if (dir && !await this.app.vault.adapter.exists(dir)) {
					await this.app.vault.createFolder(dir);
				}
				// 初始化日志文件头部
				content = `# Enhance Update Link 日志\n\n> 自动生成的操作日志\n\n---\n\n`;
			}

			// 格式化日志条目为 log 格式	
			const logLog = this.formatLogEntry(entry);
			content += logLog;

			// 写入文件
			if (logFile instanceof TFile) {
				await this.app.vault.modify(logFile, content);
			} else {
				await this.app.vault.create(this.logConfig.logPath, content);
			}

			// 控制台输出
			if (this.logConfig.consoleOutput) {
				this.debugConsole.log(`[${entry.type.toUpperCase()}] ${entry.message}`, entry.details || '');
			}
		} catch (error) {
			this.debugConsole.error("写入日志失败:", error);
		}
	}

	/**
	 * 格式化日志条目为 Markdown
	 */
	private formatLogEntry(entry: LogEntry): string {
		const typeEmoji = {
			link: '🔗',
			tag: '🏷️',
			error: '❌',
			info: 'ℹ️',
		};

		let md = `## ${typeEmoji[entry.type]} ${entry.type.toUpperCase()} - ${entry.timestamp}\n\n`;
		md += `**${entry.message}**\n\n`;

		if (entry.details) {
			for (const [key, value] of Object.entries(entry.details)) {
				md += `- ${key}： ${value}\n`;
			}
			md += '\n';
		}

		md += '---\n\n';
		return md;
	}

	/**
	 * 归档日志文件
	 */
	private async archiveLogFile() {
		try {
			const logFile = this.app.vault.getAbstractFileByPath(this.logConfig.logPath);
			if (!(logFile instanceof TFile)) return;

			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const archivePath = this.logConfig.logPath.replace('.log', `-${timestamp}.log`);

			// 重命名当前日志文件为归档文件
			await this.app.vault.rename(logFile, archivePath);
		} catch (error) {
			this.debugConsole.error('归档日志失败:', error);
		}
	}




	/**
	 * 记录错误日志
	 */
	async logError(message: string, error: any) {
		await this.writeLog({
			type: 'error',
			timestamp: new Date().toLocaleString('zh-CN'),
			message: message,
			details: {
				错误信息: error?.message || String(error),
				错误堆栈: error?.stack || '无堆栈信息',
			},
		});
	}

	/**
	 * 记录信息日志
	 */
	async logInfo(message: string, details?: Record<string, any>) {
		await this.writeLog({
			type: 'info',
			timestamp: new Date().toLocaleString('zh-CN'),
			message: message,
			details: details,
		});
	}
}

/**
 * 默认日志配置
 */
export const defaultLogConfig: LogConfig = {
	enabled: true,
	logPath: 'enhance-update-link.log',
	maxLogSize: 1024 * 1024, // 1MB
	consoleOutput: true,
};
