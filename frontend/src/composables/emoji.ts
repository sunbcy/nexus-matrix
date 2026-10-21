// 文档图标（Notion 的 Page Icon）用的表情数据。
//
// 为什么自建而不引第三方 emoji-picker：
// 1) 本项目是 LocalFirst 桌面级应用，无需完整 Unicode 表情库（1800+ 个），
//    精选常用表情即可覆盖绝大多数选择意图，包体增量 < 10KB；
// 2) 社区组件多为 React 版或强依赖框架，接入 Vue3 反而要加适配层；
// 3) 需要中文关键词搜索，第三方组件的关键词表是英文短码，对中文用户不友好。

export interface EmojiCategory {
  name: string;
  icon: string;
  emojis: string;
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    name: '常用',
    icon: '⭐',
    emojis:
      '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 👻 🤖 👽 👾 🤡 💩 💯 ✨ 💫 ⭐ 🌟 🔥 💥 💢 💨 💬 💭 ♻️ ✅ ❌ ❗ ❓ ⭕ 🚫',
  },
  {
    name: '人物',
    icon: '🧑',
    emojis:
      '👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🦵 🦶 👂 🦻 👃 🧠 🦷 🦴 👀 👁️ 👅 👄 👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🧏 🙇 🤦 🤷 👮 🕵️ 💂 👷 🤴 👸 👳 👲 🧕 🤵 👰 🤰 🤱 👼 🎅 🤶 🦸 🦹 🧙 🧚 🧛 🧜 🧝 🧞 🧟 💆 💇 🚶 🧍 🧎 🏃 💃 🕺 👯 🧖 🧗 🤺 🏇 ⛷️ 🏂 🏌️ 🏄 🚣 🏊 ⛹️ 🏋️ 🚴 🚵 🤸 🤼 🤽 🤾 🤹 🧘 🛀 🛌',
  },
  {
    name: '自然',
    icon: '🌿',
    emojis:
      '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐽 🐸 🐵 🙈 🙉 🙊 🐒 🐔 🐧 🐦 🐤 🐣 🐥 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🦟 🦗 🕷️ 🕸️ 🦂 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦞 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🦧 🐘 🦛 🦏 🐪 🐫 🦒 🦘 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🦮 🐈 🐓 🦃 🦚 🦜 🦢 🦩 🕊️ 🐇 🦝 🦨 🦡 🦫 🦦 🦥 🐁 🐀 🐿️ 🦔 🌵 🎄 🌲 🌳 🌴 🌱 🌿 ☘️ 🍀 🎍 🍃 🍂 🍁 🍄 🐚 🌾 💐 🌷 🌹 🥀 🌺 🌸 🌼 🌻 🌞 🌝 🌛 🌜 🌚 🌕 🌖 🌗 🌘 🌑 🌒 🌓 🌔 🌙 🌎 🌍 🌏 🪐 💫 ⭐ 🌟 ✨ ⚡ ☄️ 💥 🔥 🌪️ 🌈 ☀️ 🌤️ ⛅ 🌥️ ☁️ 🌧️ ⛈️ 🌨️ ❄️ ☃️ ⛄ 🌬️ 💨 💧 💦 ☔ ☂️ 🌊 🌫️',
  },
  {
    name: '食物',
    icon: '🍔',
    emojis:
      '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🫓 🥪 🥙 🧆 🌮 🌯 🥗 🥘 🫕 🥫 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🦪 🍤 🍙 🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 ☕ 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🍾 🧊 🥄 🍴 🍽️ 🥢 🧂',
  },
  {
    name: '活动',
    icon: '⚽',
    emojis:
      '⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🥊 🥋 🥅 ⛳ ⛸️ 🎣 🤿 🎽 🎿 🛷 🥌 🎯 🪁 🎮 🕹️ 🎲 🧩 🎭 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🪕 🎻 ♟️ 🎳 🏆 🥇 🥈 🥉 🏅 🎖️ 🎗️ 🎫 🎟️ 🎪 🤹 🩰',
  },
  {
    name: '旅行',
    icon: '✈️',
    emojis:
      '🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🛴 🚲 🛵 🏍️ 🛺 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩️ 💺 🛰️ 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥️ 🛳️ ⛴️ 🚢 ⚓ ⛽ 🚧 🚦 🚥 🗺️ 🗿 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲ ⛱️ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏔️ 🗻 🏕️ ⛺ 🏠 🏡 🏘️ 🏚️ 🏗️ 🏭 🏢 🏬 🏣 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛️ ⛪ 🕌 🕍 🛕 🕋 ⛩️ 🌁 🌃 🏙️ 🌄 🌅 🌆 🌇 🌉',
  },
  {
    name: '物品',
    icon: '💡',
    emojis:
      '⌚ 📱 📲 💻 ⌨️ 🖥️ 🖨️ 🖱️ 🕹️ 💽 💾 💿 📀 📼 📷 📸 📹 🎥 📽️ 🎞️ 📞 ☎️ 📟 📠 📺 📻 🎙️ 🎚️ 🎛️ 🧭 ⏱️ ⏲️ ⏰ 🕰️ ⌛ ⏳ 📡 🔋 🔌 💡 🔦 🕯️ 🧯 💸 💵 💴 💶 💷 🪙 💰 💳 💎 ⚖️ 🪜 🧰 🪛 🔧 🔨 ⚒️ 🛠️ ⛏️ 🪚 🔩 ⚙️ 🧱 ⛓️ 🧲 💣 🧨 🪓 🔪 🗡️ ⚔️ 🛡️ ⚰️ ⚱️ 🏺 🔮 📿 🧿 💈 ⚗️ 🔭 🔬 🩹 🩺 💊 💉 🩸 🧬 🦠 🧫 🧪 🌡️ 🧹 🧺 🧻 🚽 🚰 🚿 🛁 🧼 🪥 🪒 🧽 🪣 🧴 🛎️ 🔑 🗝️ 🚪 🪑 🛋️ 🛏️ 🧸 🖼️ 🪞 🪟 🛍️ 🛒 🎁 🎈 🎏 🎀 🪄 🎊 🎉 🏮 🎐 ✉️ 📩 📨 📧 💌 📥 📤 📦 🏷️ 📪 📫 📬 📭 📮 📯 📜 📃 📄 📑 🧾 📊 📈 📉 🗒️ 🗓️ 📆 📅 🗑️ 📇 🗃️ 🗳️ 🗄️ 📋 📁 📂 🗂️ 🗞️ 📰 📓 📔 📒 📕 📗 📘 📙 📚 📖 🔖 🧷 🔗 📎 🖇️ 📐 📏 🧮 📌 📍 ✂️ 🖊️ 🖋️ ✒️ 🖌️ 🖍️ 📝 ✏️ 🔍 🔎 🔏 🔐 🔒 🔓',
  },
  {
    name: '符号',
    icon: '❤️',
    emojis:
      '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉️ ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 🈶 🈚 🈸 🈺 ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕ 🛑 ⛔ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿ 🅿️ 🈳 🈂️ 🛂 🛃 🛄 🛅 🚹 🚺 🚼 🚻 🚮 🎦 📶 🔣 ℹ️ 🔤 🔡 🔠 🆖 🆗 🆙 🆒 🆕 🆓 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 🔢 #️⃣ *️⃣ ⏏️ ▶️ ⏸️ ⏯️ ⏹️ ⏺️ ⏭️ ⏮️ ⏩ ⏪ ⏫ ⏬ ◀️ 🔼 🔽 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ➕ ➖ ➗ ✖️ ♾️ 💲 💱 ™️ ©️ ®️ 〰️ ➰ ➿ 🔚 🔙 🔛 🔝 🔜 ✔️ ☑️ 🔘 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◼️ ◻️ ◾ ◽ 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜ 🟫',
  },
  {
    name: '旗帜',
    icon: '🏁',
    emojis:
      '🏁 🚩 🎌 🏴 🏳️ 🏳️‍🌈 🏴‍☠️ 🇨🇳 🇭🇰 🇲🇴 🇹🇼 🇯🇵 🇰🇷 🇸🇬 🇺🇸 🇬🇧 🇫🇷 🇩🇪 🇮🇹 🇪🇸 🇵🇹 🇳🇱 🇨🇭 🇸🇪 🇳🇴 🇩🇰 🇫🇮 🇵🇱 🇦🇹 🇧🇪 🇬🇷 🇮🇪 🇷🇺 🇺🇦 🇨🇦 🇲🇽 🇧🇷 🇦🇷 🇨🇱 🇨🇴 🇵🇪 🇦🇺 🇳🇿 🇮🇳 🇹🇭 🇻🇳 🇲🇾 🇮🇩 🇵🇭 🇦🇪 🇸🇦 🇮🇱 🇹🇷 🇪🇬 🇿🇦 🇳🇬 🇰🇪 🇺🇳 🇪🇺',
  },
];

// 扁平化的全量表情列表
export const ALL_EMOJIS: string[] = EMOJI_CATEGORIES.flatMap((c) => c.emojis.split(/\s+/).filter(Boolean));

// 中文 / 拼音关键词。只收录高频表情，其余靠分类浏览。
// 结构：表情 -> 以空格分隔的关键词（中文、拼音均可）
export const EMOJI_KEYWORDS: Record<string, string> = {
  '😀': '笑 高兴 开心 xiao gaoxing',
  '😂': '笑哭 哈哈 xiaoku haha',
  '🤣': '爆笑 打滚 baoxiao',
  '😊': '微笑 害羞 weixiao',
  '😍': '爱心 喜欢 ai love',
  '🥰': '喜欢 爱 ai',
  '😘': '亲亲 kiss',
  '🤔': '思考 想 think',
  '😴': '睡觉 困 shuijiao',
  '😭': '哭 流泪 ku',
  '😢': '哭 伤心 ku',
  '😡': '生气 愤怒 shengqi angry',
  '🤬': '暴怒 骂人 baonu',
  '😎': '酷 墨镜 cool',
  '🤓': '书呆子 geek',
  '🥳': '庆祝 派对 qingzhu party',
  '😱': '害怕 尖叫 haipa',
  '🤯': '炸了 震惊 zhale',
  '💀': '死 骷髅 skeleton',
  '👻': '鬼 ghost',
  '🤖': '机器人 robot',
  '👽': '外星人 alien',
  '💩': '垃圾 shit',
  '💯': '满分 一百 manfen',
  '✨': '闪光 星星 shanxing',
  '🔥': '火 热门 fire',
  '⭐': '星星 star',
  '🌟': '星星 闪耀 star',
  '❤️': '心 爱 红心 heart love',
  '🧡': '心 橙心 heart',
  '💚': '心 绿心 heart',
  '💙': '心 蓝心 heart',
  '💜': '心 紫心 heart',
  '🖤': '心 黑心 heart',
  '💔': '心碎 heartbreak',
  '👍': '赞 好评 zan good',
  '👎': '踩 差评 cai bad',
  '👏': '鼓掌 掌声 guzhang',
  '🙏': '拜托 感谢 祈祷 thanks',
  '💪': '肌肉 加油 力量 jiayou',
  '✋': '停 手掌 stop',
  '👌': '好的 没问题 ok',
  '✅': '完成 对 正确 done ok',
  '❌': '错 错误 关闭 wrong',
  '❗': '注意 感叹 important',
  '❓': '疑问 问题 question',
  '⚠️': '警告 注意 warning',
  '🚫': '禁止 不可 no',
  '♻️': '回收 recycle',
  '🔔': '铃铛 通知 bell',
  '💡': '灯泡 想法 idea',
  '📌': '图钉 pin',
  '📎': '回形针 attach',
  '🔗': '链接 link',
  '🔍': '搜索 放大镜 search',
  '📝': '笔记 记录 note',
  '📅': '日历 date',
  '⏰': '闹钟 时间 time',
  '🚀': '火箭 起飞 rocket',
  '🎯': '目标 靶 target',
  '🏆': '奖杯 冠军 cup',
  '💰': '钱 金钱 money',
  '💼': '公文包 工作 work',
  '📚': '书 学习 book',
  '🔒': '锁 安全 lock',
  '🔓': '开锁 unlock',
  '🌱': '萌芽 成长 新 grow',
  '🌿': '植物 plant',
  '🍀': '四叶草 幸运 luck',
  '🌸': '樱花 花 flower',
  '🌈': '彩虹 rainbow',
  '☀️': '太阳 sun',
  '🌙': '月亮 moon',
  '⚡': '闪电 power',
  '🎉': '庆祝 礼花 party',
  '🎁': '礼物 gift',
  '☕': '咖啡 coffee',
  '🍕': '披萨 pizza',
  '🐱': '猫 cat',
  '🐶': '狗 dog',
  '🦄': '独角兽 unicorn',
  '🐳': '鲸鱼 whale',
  '🦋': '蝴蝶 butterfly',
  '🏁': '旗帜 终点 flag',
  '🚩': '旗子 flag',
  '🎌': '旗帜 flag',
  '🏴‍☠️': '海盗 pirate',
};

// 按关键词过滤表情（匹配中文 / 拼音 / 表情本身）
export const searchEmojis = (query: string): string[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: string[] = [];
  for (const e of ALL_EMOJIS) {
    const kw = EMOJI_KEYWORDS[e];
    if (kw && kw.toLowerCase().includes(q)) hits.push(e);
  }
  // 关键词没命中时，把表情本身加进去（便于粘贴已知表情直接搜）
  if (ALL_EMOJIS.includes(query.trim())) hits.unshift(query.trim());
  return hits;
};

// 随机取一个表情（Notion 的 Random 按钮）
export const randomEmoji = (): string => ALL_EMOJIS[Math.floor(Math.random() * ALL_EMOJIS.length)];

// === 最近使用（Notion 的 Recents）：记住用户选过的图标，选择器里置顶显示 ===
const RECENTS_KEY = 'nexus_emoji_recents';
const RECENTS_MAX = 28;
export const getRecentEmojis = (): string[] => {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
export const rememberEmoji = (emoji: string): string[] => {
  const next = [emoji, ...getRecentEmojis().filter((e) => e !== emoji)].slice(0, RECENTS_MAX);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* 存储不可用时不阻塞选择 */
  }
  return next;
};
