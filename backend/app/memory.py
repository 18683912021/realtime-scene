"""Small, privacy-conscious session memory for the Mira companion.

Only short facts the user volunteers are kept in memory, and only for the
lifetime of the WebSocket session. They are injected into the system prompt so
Mira can sound like someone who was actually listening, without reciting a
profile back at the user.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

NAME_RE = re.compile(r"(?:我叫|叫我|你可以叫我)([\u4e00-\u9fa5A-Za-z]{1,10})")
CITY_RE = re.compile(
    r"(?:我住在|我来自)([\u4e00-\u9fa5]{2,8})|我在([\u4e00-\u9fa5]{2,8})(?:生活|工作|上班|读书|长大)"
)
LIKE_RE = re.compile(r"我(?:很|最|也|有点)?(喜欢|爱|讨厌|不太喜欢)([^，。！？!?；;\s]{1,16})")
JOB_RE = re.compile(r"我是(?:一个|一名)?([^，。！？!?；;\s]{2,20}?)(?:，|。|！|？|;|$)")
NOTE_RE = re.compile(r"(?:我)?(?:最近|这两天|这阵子|今天)(?:在|想|准备|需要|刚)([^，。！？!?；;]{2,30})")
MOOD_WORDS = {
    "累": "最近有点累",
    "疲惫": "最近有点累",
    "难过": "最近心情低落",
    "焦虑": "最近有些焦虑",
    "压力": "最近压力比较大",
    "失眠": "最近睡不好",
    "烦": "最近有点烦",
    "开心": "最近心情不错",
    "高兴": "最近心情不错",
    "不错": "最近状态不错",
}
TOPIC_WORDS = (
    "工作", "上班", "旅行", "摄影", "相机", "城市", "咖啡", "面包", "家", "朋友",
    "睡眠", "运动", "跑步", "音乐", "电影", "游戏", "宠物", "猫", "狗", "美食",
    "书", "读书", "天气", "雨", "孤独", "家人",
)


@dataclass
class ConversationMemory:
    name: str = ""
    city: str = ""
    job: str = ""
    likes: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    mood: str = ""
    topics: list[str] = field(default_factory=list)

    def observe(self, text: str) -> None:
        value = text.strip()
        if not value:
            return

        if not self.name:
            match = NAME_RE.search(value)
            if match:
                self.name = match.group(1)

        if not self.city:
            match = CITY_RE.search(value)
            if match:
                self.city = (match.group(1) or match.group(2) or "").strip()

        if not self.job:
            match = JOB_RE.search(value)
            if match:
                job = match.group(1).strip()
                if job and not any(word in job for word in ("有点", "不太", "很", "真的")):
                    self.job = job

        for match in NOTE_RE.finditer(value):
            note = match.group(1).strip(" ，。！？!?；;")
            if 2 <= len(note) <= 28 and note not in self.notes:
                self.notes.append(note)
        self.notes = self.notes[-4:]

        for match in LIKE_RE.finditer(value):
            verb, obj = match.group(1), match.group(2).strip()
            phrase = f"{'不喜欢' if verb in {'讨厌', '不太喜欢'} else '喜欢'}{obj}"
            if phrase not in self.likes:
                self.likes.append(phrase)
        self.likes = self.likes[-6:]

        for word, phrase in MOOD_WORDS.items():
            if word in value:
                self.mood = phrase
                break

        for word in TOPIC_WORDS:
            if word in value and word not in self.topics:
                self.topics.append(word)
        self.topics = self.topics[-8:]

    def prompt(self) -> str:
        parts: list[str] = []
        if self.name:
            parts.append(f"对方希望被称呼为：{self.name}")
        if self.city:
            parts.append(f"对方常驻/来自：{self.city}")
        if self.job:
            parts.append(f"对方的身份/工作：{self.job}")
        if self.likes:
            parts.append("对方提到过：" + "、".join(self.likes))
        if self.notes:
            parts.append("对方最近提到：" + "；".join(self.notes))
        if self.mood:
            parts.append(self.mood)
        if self.topics:
            parts.append("聊过：" + "、".join(self.topics))
        value = "；".join(parts)
        return value[:420]
