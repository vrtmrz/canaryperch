import { App, Notice, Plugin, PluginSettingTab, Setting, debounce, normalizePath } from 'obsidian';

interface CanaryPerchSettings {
	nestURL: string;
	fetchFilter: string;
	autoRestartPlugin: boolean;
}

const DEFAULT_SETTINGS: CanaryPerchSettings = {
	nestURL: "",
	fetchFilter: "",
	autoRestartPlugin: false
}

export default class CanaryPerchPlugin extends Plugin {
	settings: CanaryPerchSettings;
	isWatching = false;
	eventSource: EventSource | undefined = undefined;

	esOnOpen(event: Event): void {
		new Notice("Canary watching has been started");
		console.log(event);
	}
	esOnError(event: Event): void {
		new Notice("Canary watching has been finished at error");
		console.log(event);

	}
	esOnMessage(event: MessageEvent<any>): void {
		console.log(event);
	}
	async ensureDirectoryEx(fullPath: string) {
		const pathElements = fullPath.split("/");
		pathElements.pop();
		let c = "";
		for (const v of pathElements) {
			c += v;
			try {
				await this.app.vault.adapter.mkdir(c);
			} catch (ex) {
				// basically skip exceptions.
				if (ex.message && ex.message == "Folder already exists.") {
					// especially this message is.
				} else {
					new Notice(`Could not create folder :${ex.message}`);
				}
			}
			c += "/";
		}
	}
	async esOnFileMessage(event: MessageEvent<string>): Promise<void> {
		console.log(`File has been changed at server! ${event.data}`);
		const filepath = event.data;

		if (!filepath.match(this.settings.fetchFilter)) {
			console.log(`But not interested for me.`);
			return;
		}
		new Notice(`Canary "${filepath}" flew in!`);

		const url = new URL(this.settings.nestURL);
		url.pathname = filepath;
		let b: Blob;
		try {
			b = await (await fetch(url)).blob();
		} catch (ex) {
			new Notice(`Could not capture "${filepath}", ${ex.message}`);
			console.dir(ex);
			return;
		}
		const writePath = normalizePath(this.app.vault.configDir + "/" + filepath);
		try {
			this.ensureDirectoryEx(writePath);
			this.app.vault.adapter.writeBinary(writePath, await b.arrayBuffer());
		} catch (ex) {
			new Notice(`Could not save "${writePath}", ${ex.message}`);
			console.dir(ex);
			return;
		}
		new Notice(`The canary "${writePath}" has been saved into the storage.`);
		if (!this.settings.autoRestartPlugin) return;
		if (filepath.startsWith("plugins/")) {
			const pluginPath = filepath.split("/").slice(0, 2).join("/");
			this.reloadPlugin(pluginPath);
		}

	}
	reloadPlugin(pluginPath: string) {
		const configPath = this.app.vault.configDir;
		// @ts-ignore
		const enabledPlugins = this.app.plugins.enabledPlugins as Set<string>;
		// @ts-ignore
		const targetPluginId = Object.values(this.app.plugins.plugins).filter(e => enabledPlugins.has(e.manifest.id)).find(e => e.manifest.dir.startsWith(`${configPath}/${pluginPath}`))?.manifest?.id;
		// @ts-ignore
		this.app.plugins.unloadPlugin(targetPluginId).then(async () => {
			// @ts-ignore
			await this.app.plugins.loadPlugin(targetPluginId);
			new Notice(`${targetPluginId} has been reloaded!`)
		});
	}
	esOnPingMessage(event: MessageEvent<string>): void {
		console.log(`Ping from ${event.data}`);
	}

	startWatch() {
		if (this.eventSource != undefined) {
			this.eventSource.close();
		}
		try {
			this.eventSource = new EventSource(this.settings.nestURL)
			this.eventSource.addEventListener("open", (ev: Event) => this.esOnOpen(ev));
			this.eventSource.addEventListener("close", (ev: Event) => this.esOnError(ev));
			this.eventSource.addEventListener("error", (ev: Event) => this.esOnError(ev));
			this.eventSource.addEventListener("message", (ev: MessageEvent<any>) => this.esOnMessage(ev));
			this.eventSource.addEventListener("ping", (ev: MessageEvent<string>) => this.esOnPingMessage(ev));
			this.eventSource.addEventListener("file", (ev: MessageEvent<string>) => this.esOnFileMessage(ev));
			this.isWatching = true;
		} catch (ex) {
			new Notice("Error on open eventsource")
			this.stopWatch();
		}
	}
	stopWatch() {
		this.isWatching = false;
		if (this.eventSource != undefined) {
			this.eventSource.close();
			this.eventSource = undefined;
		}
		new Notice("Canary watching has been finished")

	}
	async onload() {
		await this.loadSettings();
		this.addStatusBarItem();
		this.reloadPlugin = debounce(this.reloadPlugin.bind(this), 1000);
		this.addCommand({
			id: 'start-watch',
			name: 'Start watching canaries',
			checkCallback: (checking) => {
				if (checking) return !this.isWatching;
				this.startWatch();
			}
		});
		this.addCommand({
			id: 'stop-watch',
			name: 'Stop watching canaries',
			checkCallback: (checking) => {
				if (checking) return this.isWatching;
				this.stopWatch();
			}
		});


		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new CanaryPerchSettingTab(this.app, this));
	}

	onunload() {
		this.stopWatch();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class CanaryPerchSettingTab extends PluginSettingTab {
	plugin: CanaryPerchPlugin;

	constructor(app: App, plugin: CanaryPerchPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}


	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Canary nest URL')
			.setDesc('The address of Canary Nest with authenticate key.')
			.addText(text => {
				text
					.setPlaceholder('https://....../_watch?q=foobar')
					.setValue(this.plugin.settings.nestURL)
					.onChange(async (value) => {
						this.plugin.settings.nestURL = value;
						await this.plugin.saveSettings();
					})
				// text.inputEl.setAttr("type", "url");
				return text;
			});
		const filterConfig = new Setting(containerEl)
			.setName('Interesting paths')
			.setDesc('We will fetch the changes which matched this setting (regular expression)')
			.addText(text => {
				text
					.setPlaceholder('^\\/plugins\\/(obsidian-livesync|obsidian-tagfolder)')
					.setValue(this.plugin.settings.fetchFilter)
					.onChange(async (value) => {
						try {
							// Check for regular expression
							new RegExp(value);
							this.plugin.settings.fetchFilter = value;
							await this.plugin.saveSettings();
							filterConfig.controlEl.removeClass("cp-warn");
						} catch (ex) {
							filterConfig.controlEl.addClass("cp-warn");
						}
					})
				// text.inputEl.setAttr("type", "url");
				return text;
			});
		new Setting(containerEl)
			.setName('Auto restart plugin')
			.addToggle(toggle => {
				toggle
					.setValue(this.plugin.settings.autoRestartPlugin)
					.onChange(async (value) => {
						this.plugin.settings.autoRestartPlugin = value;
						await this.plugin.saveSettings();
					})
				return toggle;
			});
	}
}
