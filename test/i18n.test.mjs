import { test } from "node:test";
import assert from "node:assert/strict";
import { pickLang } from "../src/i18n.mjs";

test("CPP_LANG=zh or en overrides the system language; any other value is ignored", () => {
  const saved = process.env.CPP_LANG;
  try {
    delete process.env.CPP_LANG;
    const system = pickLang();
    process.env.CPP_LANG = "zh";
    assert.equal(pickLang(), "zh");
    process.env.CPP_LANG = "en";
    assert.equal(pickLang(), "en");
    process.env.CPP_LANG = "fr";
    assert.equal(pickLang(), system);
  } finally {
    if (saved === undefined) delete process.env.CPP_LANG;
    else process.env.CPP_LANG = saved;
  }
});
