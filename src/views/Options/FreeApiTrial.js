import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { DEFAULT_API_LIST, OPT_TRANS_MYMEMORY } from "../../config/api";
import { apiTranslate } from "../../apis";
import { useSetting } from "../../hooks/Setting";
import { useRules } from "../../hooks/Rules";
import { applyNetworkPolicy } from "../../libs/networkPolicy";
import { SettingsSegmented } from "./SettingsCard";

export const FREE_API_TRIAL_SAMPLES = {
  enToZh: {
    text: "The library opens at nine in the morning.",
    fromLang: "en",
    toLang: "zh-CN",
  },
  zhToEn: { text: "图书馆每天早上九点开门。", fromLang: "zh-CN", toLang: "en" },
};

export default function FreeApiTrial() {
  const { setting, updateSetting } = useSetting();
  const rules = useRules();
  const [direction, setDirection] = useState("enToZh");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState("");
  const [notice, setNotice] = useState(null);
  const testController = useRef(null);
  const preset = DEFAULT_API_LIST.find(
    (api) => api.apiType === OPT_TRANS_MYMEMORY
  );
  const sample = FREE_API_TRIAL_SAMPLES[direction];
  const isOffline = setting.networkPolicy === "offline";
  const added = Boolean(
    preset && setting.transApis?.some((api) => api.apiSlug === preset.apiSlug)
  );
  const activeGlobally = Boolean(
    preset &&
      rules.list?.some(
        (rule) => rule.pattern === "*" && rule.apiSlug === preset.apiSlug
      )
  );

  useEffect(() => () => testController.current?.abort(), []);

  const handleTest = async () => {
    if (testController.current || !preset) return;
    setNotice(null);
    setResult("");
    const controller = new AbortController();
    testController.current = controller;
    try {
      applyNetworkPolicy(preset.url, {}, setting.networkPolicy || "normal");
      setTesting(true);
      const { trText } = await apiTranslate({
        ...sample,
        // Test the published no-key preset, never a saved custom URL/key/hook.
        apiSetting: { ...preset, key: "", reqHook: "", resHook: "" },
        useCache: false,
        usePool: false,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (typeof trText !== "string" || !trText.trim())
        throw new Error("免费接口返回了空译文，请稍后再试。");
      setResult(trText);
      setNotice({
        severity: "success",
        text: "免费接口已返回以下译文。本次测试没有保存配置或切换翻译服务。",
      });
    } catch (error) {
      if (!controller.signal.aborted)
        setNotice({
          severity: "error",
          text: error?.message || "免费接口暂时不可用，请检查网络或稍后再试。",
        });
    } finally {
      if (testController.current === controller) testController.current = null;
      if (!controller.signal.aborted) setTesting(false);
    }
  };

  const handleAdd = () => {
    if (!preset) return;
    try {
      updateSetting((previous) => {
        if (previous.transApis?.some((api) => api.apiSlug === preset.apiSlug))
          return previous;
        return {
          ...previous,
          transApis: [...(previous.transApis || []), { ...preset }],
        };
      });
      setNotice({
        severity: "success",
        text: "已添加到翻译服务。请刷新阅读页面，再在翻译面板中选择 MyMemory；当前默认服务保持原样。",
      });
    } catch (error) {
      setNotice({
        severity: "error",
        text: error?.message || "服务未能保存，请重试。",
      });
    }
  };

  const handleEnableNetwork = () => {
    try {
      updateSetting((previous) => ({
        ...previous,
        networkPolicy: "no-google",
      }));
      setNotice({
        severity: "info",
        text: "已切到屏蔽谷歌模式，允许非谷歌云端服务联网。现在可点击“测试免费接口”；本次切换没有发送示例句。",
      });
    } catch (error) {
      setNotice({
        severity: "error",
        text: error?.message || "联网策略未能保存，请重试。",
      });
    }
  };

  return (
    <Card
      component="section"
      aria-label="MyMemory 免费接口试用"
      variant="outlined"
      sx={{
        p: { xs: 2, sm: 2.5 },
        borderRadius: 3,
        borderColor: "primary.main",
      }}
    >
      <Stack spacing={2}>
        <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
          <Typography component="h2" variant="h6">
            MyMemory · 免Key试用
          </Typography>
          <Chip
            label="中英翻译"
            size="small"
            color="primary"
            variant="outlined"
          />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          免费但有使用额度，需要云端联网，无需 API Key。每次请求最多 500
          字节，较长文本由插件自动分段。这是普通翻译接口，不是聊天 AI，不使用
          Skill。
        </Typography>
        <Link
          href="https://mymemory.translated.net/doc/spec.php"
          target="_blank"
          rel="noopener noreferrer"
          variant="body2"
        >
          MyMemory 官方接口文档
        </Link>
        <SettingsSegmented
          label="免费接口测试方向"
          value={direction}
          items={[
            { value: "enToZh", label: "英文 → 中文", disabled: testing },
            { value: "zhToEn", label: "中文 → 英文", disabled: testing },
          ]}
          onChange={(next) => {
            setDirection(next);
            setResult("");
            setNotice(null);
          }}
        />
        <Box sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 2 }}>
          <Typography variant="caption" color="text.secondary">
            固定示例句 · {new Blob([sample.text]).size} / 500 字节
          </Typography>
          <Typography sx={{ mt: 0.5 }} data-testid="free-api-source">
            {sample.text}
          </Typography>
        </Box>
        <Typography variant="caption" color="text.secondary">
          仅点击测试按钮后，才会把上方示例句发送给 MyMemory，不传 API
          Key。服务商可能留存请求文本。
        </Typography>
        {isOffline && (
          <Alert severity="info">
            当前为仅本机离线模式，云端测试已禁用。你可以去
            <Link href="#/">常规设置</Link>
            调整，或点击下方按钮切到屏蔽谷歌模式；这会允许非谷歌云端服务联网，但不会立即测试。
          </Alert>
        )}
        {!preset && (
          <Alert severity="warning">
            免费接口预设尚不可用，请更新扩展后重试。
          </Alert>
        )}
        <Stack direction="row" gap={1} flexWrap="wrap">
          {isOffline && (
            <Button
              variant="outlined"
              onClick={handleEnableNetwork}
              disabled={testing}
            >
              切到屏蔽谷歌模式
            </Button>
          )}
          <Button
            variant="contained"
            onClick={handleTest}
            disabled={testing || isOffline || !preset}
          >
            {testing ? "正在测试免费接口…" : "测试免费接口"}
          </Button>
          <Button
            variant="outlined"
            onClick={handleAdd}
            disabled={testing || added || !preset}
          >
            添加到翻译服务
          </Button>
        </Stack>
        {added && (
          <Typography variant="caption" color="text.secondary">
            MyMemory 已在服务列表中，保留既有配置。
            {activeGlobally
              ? "当前已设为全局服务。"
              : "刷新阅读页面后，可在翻译面板选择。"}
          </Typography>
        )}
        <Box role="status" aria-live="polite">
          {notice && <Alert severity={notice.severity}>{notice.text}</Alert>}
          {result && (
            <Box
              sx={{ mt: 1.5, p: 1.5, bgcolor: "action.hover", borderRadius: 2 }}
            >
              <Typography variant="caption" color="text.secondary">
                MyMemory 实际返回
              </Typography>
              <Typography
                sx={{
                  mt: 0.5,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
                data-testid="free-api-result"
              >
                {result}
              </Typography>
            </Box>
          )}
        </Box>
      </Stack>
    </Card>
  );
}
