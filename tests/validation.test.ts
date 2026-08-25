import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCategory,
  assertStatus,
  assertTaskTagColor,
  normalizeCompletedAt,
  normalizeCompletedTaskFilter,
  normalizeSupportAgentName,
  normalizeTaskTagName,
  normalizeTitle,
  normalizeUrl,
} from "@/lib/validation";

test("accepts the fixed task categories and statuses", () => {
  assert.doesNotThrow(() => assertCategory("requirement"));
  assert.doesNotThrow(() => assertCategory("bug"));
  assert.doesNotThrow(() => assertStatus("blocked"));
  assert.throws(() => assertCategory("other"));
  assert.throws(() => assertStatus("inbox"));
});

test("normalizes titles and rejects blank titles", () => {
  assert.equal(normalizeTitle("  修复登录问题  "), "修复登录问题");
  assert.throws(() => normalizeTitle("   "), /标题不能为空/);
});

test("normalizes support agent names and rejects invalid values", () => {
  assert.equal(normalizeSupportAgentName("  小王  "), "小王");
  assert.throws(() => normalizeSupportAgentName("   "), /客服姓名不能为空/);
  assert.throws(() => normalizeSupportAgentName("a".repeat(41)), /不能超过 40 个字符/);
});

test("validates task tag names and fixed colors", () => {
  assert.equal(normalizeTaskTagName("  移动端  "), "移动端");
  assert.throws(() => normalizeTaskTagName("   "), /标签名称不能为空/);
  assert.throws(() => normalizeTaskTagName("a".repeat(21)), /不能超过 20 个字符/);
  assert.doesNotThrow(() => assertTaskTagColor("teal"));
  assert.throws(() => assertTaskTagColor("purple"), /标签颜色无效/);
});

test("accepts http links and rejects unsafe protocols", () => {
  assert.equal(normalizeUrl("https://example.com/docs"), "https://example.com/docs");
  assert.throws(() => normalizeUrl("javascript:alert(1)"), /http 或 https/);
});

test("normalizes historical completion times and rejects future times", () => {
  const historical = new Date(Date.now() - 60_000).toISOString();
  assert.equal(normalizeCompletedAt(historical), historical);
  assert.throws(() => normalizeCompletedAt(new Date(Date.now() + 60_000).toISOString()), /不能晚于当前时间/);
  assert.throws(() => normalizeCompletedAt("not-a-date"), /完成时间无效/);
});

test("validates custom completed-task ranges", () => {
  const filter = normalizeCompletedTaskFilter({
    preset: "custom",
    from: "2026-01-01T00:00:00.000Z",
    to: "2026-01-08T00:00:00.000Z",
  });
  assert.equal(filter.from, "2026-01-01T00:00:00.000Z");
  assert.throws(
    () => normalizeCompletedTaskFilter({ preset: "custom", from: "2026-01-08T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" }),
    /开始日期必须早于结束日期/,
  );
});
