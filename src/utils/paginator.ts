import {
  Command,
  Constants,
  GatewayClientEvents,
  Structures,
  Utils,
} from 'detritus-client';

const {
  ClientEvents,
  DiscordRegexNames,
} = Constants;


export const MAX_PAGE = Number.MAX_SAFE_INTEGER;
export const MIN_PAGE = 1;

export const PageEmojis = Object.freeze({
  custom: '🔢',
  info: 'ℹ',
  next: '▶',
  previous: '◀',
  stop: '⏹',
});

export const PageEmojisOrder = Object.freeze(['previous', 'next', 'custom', 'stop', 'info']);

export type OnErrorCallback = (error: any, paginator: Paginator) => Promise<any> | any;
export type OnExpireCallback = (paginator: Paginator) => Promise<any> | any;
export type OnPageCallback = (page: number) => Promise<Utils.Embed> | Utils.Embed;
export type OnPageNumberCallback = (content: string) => Promise<number> | number;

export interface PaginatorEmojis {
  custom?: Structures.Emoji | string,
  info?: Structures.Emoji | string,
  next?: Structures.Emoji | string,
  previous?: Structures.Emoji | string,
  stop?: Structures.Emoji | string,
}

export interface PaginatorOptions {
  emojis?: PaginatorEmojis,
  expire?: number,
  message?: Structures.Message,
  page?: number,
  pageLimit?: number,
  pages?: Array<Utils.Embed>,
  targets?: Array<Structures.Member | Structures.User | string>,

  onError?: OnErrorCallback,
  onExpire?: OnExpireCallback,
  onPage?: OnPageCallback,
  onPageNumber?: OnPageNumberCallback,
}

export class Paginator {
  readonly callbacks: {[key: string]: Function | null};
  readonly context: Command.Context | Structures.Message;
  readonly custom: {
    expire: number,
    message?: null | Structures.Message,
    timeout: any | null,
    userId?: null | string,
  } = {
    expire: 10000,
    timeout: null,
  };

  emojis: {[key: string]: Structures.Emoji} = {};
  expires: number = 60000;
  isOnGuide: boolean = false;
  message: null | Structures.Message = null;
  page: number = MIN_PAGE;
  pageLimit: number = MAX_PAGE;
  pages?: Array<Utils.Embed>;
  stopped: boolean = false;
  targets: Array<string> = [];
  timeout?: any = null;

  onError?: OnErrorCallback;
  onExpire?: OnExpireCallback;
  onPage?: OnPageCallback;
  onPageNumber?: OnPageNumberCallback;

  constructor(
    context: Command.Context | Structures.Message,
    options: PaginatorOptions,
  ) {
    this.context = context;
    this.message = options.message || null;

    if (Array.isArray(options.pages)) {
      this.pages = options.pages;
      this.pageLimit = this.pages.length;
    } else {
      if (options.pageLimit !== undefined) {
        this.pageLimit = Math.max(MIN_PAGE, Math.min(options.pageLimit, MAX_PAGE));
      }
    }

    if (options.page !== undefined) {
      this.page = Math.max(MIN_PAGE, Math.min(options.page, MAX_PAGE));
    }

    if (Array.isArray(options.targets)) {
      for (let target of options.targets) {
        if (typeof(target) === 'string') {
          this.targets.push(target);
        } else {
          this.targets.push(target.id);
        }
      }
    } else {
      if (context instanceof Structures.Message) {
        this.targets.push(context.author.id);
      } else {
        this.targets.push(context.userId);
      }
    }

    if (!this.targets.length) {
      throw new Error('A userId must be specified in the targets array');
    }

    const emojis: {
      [key: string]: string | Structures.Emoji,
    } = Object.assign({}, PageEmojis, options.emojis);
    for (let key in PageEmojis) {
      const value = emojis[key];
      if (typeof(value) === 'string') {
        let emoji: Structures.Emoji;

        let match = Utils.regex(DiscordRegexNames.EMOJI, value);
        if (match) {
          emoji = new Structures.Emoji(context.client, match);
        } else {
          emoji = new Structures.Emoji(context.client, {name: value});
        }
        this.emojis[key] = emoji;
      }
      if (!(this.emojis[key] instanceof Structures.Emoji)) {
        throw new Error(`Emoji for ${key} must be a string or Emoji structure`);
      }
    }

    this.callbacks = {};
    this.onError = options.onError;
    this.onExpire = options.onExpire;
    this.onPage = options.onPage;
    this.onPageNumber = options.onPageNumber;

    Object.defineProperties(this, {
      callbacks: {enumerable: false},
      context: {enumerable: false},
      custom: {enumerable: false},
      emojis: {enumerable: false},
      message: {enumerable: false},
      timeout: {enumerable: false},
      onError: {enumerable: false},
      onExpire: {enumerable: false},
      onPage: {enumerable: false},
      onPageNumber: {enumerable: false},
    });
  }

  addPage(embed: Utils.Embed): Paginator {
    if (typeof(this.onPage) === 'function') {
      throw new Error('Cannot add a page when onPage is attached to the paginator');
    }
    if (!Array.isArray(this.pages)) {
      this.pages = [];
    }
    this.pages.push(embed);
    this.pageLimit = this.pages.length;
    return this;
  }

  async clearCustomMessage(): Promise<void> {
    if (this.custom.timeout !== null) {
      clearTimeout(this.custom.timeout);
      this.custom.timeout = null;
    }
    if (this.custom.message) {
      try {
        await this.custom.message.delete();
      } catch(error) {}
      this.custom.message = null;
    }
  }

  async getGuidePage(): Promise<Utils.Embed> {
    const embed = new Utils.Embed();
    embed.setTitle('Interactive Paginator Guide');
    embed.setDescription([
      'This allows you to navigate through pages of text using reactions.\n',
      `${this.emojis.previous} - Goes back one page`,
      `${this.emojis.next} - Goes forward one page`,
      `${this.emojis.custom} - Allows you to choose a number via text`,
      `${this.emojis.stop} - Stops the paginator`,
      `${this.emojis.info} - Shows this guide`,
    ].join('\n'));
    embed.setFooter(`We were on page ${this.page.toLocaleString()}.`);
    return embed;
  }

  async getPage(page: number): Promise<Utils.Embed> {
    if (typeof(this.onPage) === 'function') {
      return await Promise.resolve(this.onPage(this.page));
    }
    if (Array.isArray(this.pages)) {
      page -= 1;
      if (page in this.pages) {
        return this.pages[page];
      }
    }
    throw new Error(`Page ${page} not found`);
  }

  async setPage(page: number): Promise<void> {
    if (this.message && (this.isOnGuide || page !== this.page)) {
      this.isOnGuide = false;
      this.page = page;
      const embed = await this.getPage(page);
      await this.message.edit({embed: <any> embed});
    }
  }

  async onMessageCreate({
    message,
  }: GatewayClientEvents.MessageCreate) {
    if (!this.message || message.channelId !== this.message.channelId) {
      return;
    }
    if (this.custom.message) {
      if (message.author.id !== this.custom.userId && !message.author.isClientOwner) {
        return;
      }
      let page = parseInt(message.content);
      if (!isNaN(page)) {
        page = Math.max(MIN_PAGE, Math.min(page, this.pageLimit));
        await this.clearCustomMessage();
        if (message.canDelete) {
          try {
            await message.delete();
          } catch(error) {}
        }
        await this.setPage(page);
      }
    }
  }

  async onMessageDelete({
    raw,
  }: GatewayClientEvents.MessageDelete) {
    if (this.message && this.message.id === raw.id) {
      await this.onStop();
    }
    if (this.custom.message && this.custom.message.id === raw.id) {
      this.custom.message = null;
    }
  }

  async onMessageReactionAdd({
    messageId,
    reaction,
    userId,
  }: GatewayClientEvents.MessageReactionAdd) {
    if (this.stopped) {
      return;
    }
    if (!this.message || this.message.id !== messageId) {
      return;
    }
    if (!this.targets.includes(userId) && !this.context.client.isOwner(userId)) {
      return;
    }

    try {
      switch (reaction.emoji.endpointFormat) {
        case this.emojis.next.endpointFormat: {
          const page = this.page + 1;
          if (this.pageLimit < page) {
            break;
          }
          await this.setPage(page);
        }; break;
        case this.emojis.previous.endpointFormat: {
          const page = this.page - 1;
          if (page < MIN_PAGE) {
            break;
          }
          await this.setPage(page);
        }; break;
        case this.emojis.custom.endpointFormat: {
          if (!this.custom.message) {
            await this.clearCustomMessage();
            this.custom.message = await this.message.reply('What page would you like to go to?');
            this.custom.timeout = setTimeout(async () => {
              await this.clearCustomMessage();
            }, this.custom.expire);
          }
        }; break;
        case this.emojis.stop.endpointFormat: {
          await this.onStop();
        }; break;
        case this.emojis.info.endpointFormat: {
          if (!this.isOnGuide) {
            this.isOnGuide = true;
            const embed = await this.getGuidePage();
            await this.message.edit({embed: <any> embed});
          }
        }; break;
        default: {
          return;
        };
      }

      if (this.message.canDelete) {
        await reaction.delete(userId);
      }
    } catch(error) {
      if (typeof(this.onError) === 'function') {
        await Promise.resolve(this.onError(error, this));
      }
    }
  }

  async onMessageReactionRemoveAll({
    messageId,
  }: GatewayClientEvents.MessageReactionRemoveAll) {
    if (this.message && this.message.id === messageId) {
      await this.onStop();
    }
  }

  async onStop(error?: any) {
    this.reset();
    if (!this.stopped) {
      this.stopped = true;
      try {
        if (error) {
          if (typeof(this.onError) === 'function') {
            await Promise.resolve(this.onError(error, this));
          }
        }
        if (typeof(this.onExpire) === 'function') {
          await Promise.resolve(this.onExpire(this));
        }
      } catch(error) {
        if (typeof(this.onError) === 'function') {
          await Promise.resolve(this.onError(error, this));
        }
      }
      if (this.message && this.message.canManage) {
        try {
          await this.message.deleteReactions();
        } catch(error) {}
      }
      await this.clearCustomMessage();
    }
  }

  reset() {
    for (let callback in this.callbacks) {
      const func = this.callbacks[callback];
      if (func !== null) {
        this.context.client.removeListener(callback, func);
        this.callbacks[callback] = null;
      }
    }
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (this.custom.timeout !== null) {
      clearTimeout(this.custom.timeout);
      this.custom.timeout = null;
    }
  }

  async start() {
    if (typeof(this.onPage) !== 'function' && !(this.pages && this.pages.length)) {
      throw new Error('Paginator needs an onPage function or at least one page added to it');
    }
    if (!this.message) {
      if (!this.context.canReply) {
        throw new Error('Cannot create messages in this channel');
      }
      const embed = await this.getPage(this.page);
      this.message = await this.context.reply({embed: <any> embed});
    }

    this.reset();
    if (!this.stopped && this.pageLimit !== MIN_PAGE && this.message.canReact) {
      this.callbacks[ClientEvents.MESSAGE_CREATE] = this.onMessageCreate.bind(this);
      this.callbacks[ClientEvents.MESSAGE_DELETE] = this.onMessageDelete.bind(this);
      this.callbacks[ClientEvents.MESSAGE_REACTION_ADD] = this.onMessageReactionAdd.bind(this);
      this.callbacks[ClientEvents.MESSAGE_REACTION_REMOVE_ALL] = this.onMessageReactionRemoveAll.bind(this);

      for (let callback in this.callbacks) {
        const func = this.callbacks[callback];
        if (func !== null) {
          this.context.client.addListener(callback, func);
          this.callbacks[callback] = null;
        }
      }

      this.timeout = setTimeout(this.onStop.bind(this), this.expires);

      try {
        for (let key of PageEmojisOrder) {
          if (key in this.emojis) {
            await this.message.react(this.emojis[key].endpointFormat);
          }
        }
      } catch(error) {
        if (typeof(this.onError) === 'function') {
          this.onError(error, this);
        }
      }
    }
  }
}
