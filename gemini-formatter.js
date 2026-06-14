class GeminiResponseFormatter {
  constructor() {
    this.buffer = "";
    this.lastTextLength = 0;
    this.hasPrefix = false;
  }

  parseChunk(chunk) {
    this.buffer += chunk;

    if (!this.hasPrefix) {
      const newLineIdx = this.buffer.indexOf("\n");
      if (newLineIdx !== -1) {
        const potentialPrefix = this.buffer.substring(0, newLineIdx).trim();
        if (potentialPrefix === ")]}'") {
          this.buffer = this.buffer.substring(newLineIdx + 1).trimStart();
          this.hasPrefix = true;
        }
      }
      if (this.buffer.length > 100) this.hasPrefix = true;
    }

    let extractedText = "";

    while (this.buffer.length > 0) {
      const newLineIdx = this.buffer.indexOf("\n");
      if (newLineIdx === -1) break;

      const lengthStr = this.buffer.substring(0, newLineIdx).trim();
      const length = parseInt(lengthStr, 10);

      if (isNaN(length)) {
        this.buffer = this.buffer.substring(newLineIdx + 1);
        continue;
      }

      if (this.buffer.length < newLineIdx + 1 + length) break;

      const jsonData = this.buffer.substring(newLineIdx + 1, newLineIdx + 1 + length);
      this.buffer = this.buffer.substring(newLineIdx + 1 + length).trimStart();

      const delta = this.processJsonBlock(jsonData);
      if (delta) extractedText += delta;
    }

    return extractedText;
  }

  processJsonBlock(jsonStr) {
    try {
      const envelope = JSON.parse(jsonStr);
      for (const item of envelope) {
        if (item[0] === "wrb.fr" && typeof item[2] === "string") {
          const inner = JSON.parse(item[2]);

          let fullText = inner?.[4]?.[0]?.[1]?.[0];

          if (fullText) {
            const delta = fullText.substring(this.lastTextLength);
            this.lastTextLength = fullText.length;
            return delta;
          }
        }
      }
    } catch (e) {
      console.warn("Failed to parse Gemini JSON block:", e);
    }
    return "";
  }

  reset() {
    this.buffer = "";
    this.lastTextLength = 0;
    this.hasPrefix = false;
  }
}
