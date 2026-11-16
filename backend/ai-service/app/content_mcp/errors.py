"""Content MCP 호출 실패 경계."""


class ContentMcpFailure(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
