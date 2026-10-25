from typing import Literal
from pydantic import BaseModel, Field


class SessionStart(BaseModel):
    type: Literal["session.start"]
    sessionId: str = Field(min_length=1, max_length=128)
    clientVersion: str = "web"
    mode: Literal["mock", "live"] = "mock"


class UserText(BaseModel):
    type: Literal["user.text"]
    sessionId: str = Field(min_length=1, max_length=128)
    turnId: str = Field(min_length=1, max_length=128)
    epoch: int = Field(ge=0)
    text: str = Field(min_length=1, max_length=2000)
    inputMode: Literal["text", "voice"] = "text"


class UserInterrupt(BaseModel):
    type: Literal["user.interrupt"]
    sessionId: str
    interruptedTurnId: str | None = None
    newEpoch: int = Field(ge=0)


class SessionEnd(BaseModel):
    type: Literal["session.end"]
    sessionId: str | None = None
    reason: str = "client_stop"


class Ping(BaseModel):
    type: Literal["ping"]
