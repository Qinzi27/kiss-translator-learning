import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import { useSetting } from "../../hooks/Setting";
import { useRules } from "../../hooks/Rules";
import { isExt } from "../../libs/client";
import { applyNetworkPolicy } from "../../libs/networkPolicy";
import { apiTranslate } from "../../apis";
import {
  AI_SERVICES,
  CUSTOM_AI_SERVICE,
  buildLearningAiApi,
  getLearningAiSlug,
  upsertLearningAiApi,
} from "../../config/aiServices";
import {
  TRANSLATION_SKILL_CORE,
  TRANSLATION_SKILL_LIMITS,
} from "../../config/translationSkill";
import { SettingsSegmented } from "./SettingsCard";
import FreeApiTrial from "./FreeApiTrial";

export const AI_SERVICE_TEST_TEXT =
  "This is a translation test. Please keep the number 2026 unchanged.";

function initialDraft(service, transport, apis) {
  const saved = apis.find(
    (api) => api.apiSlug === getLearningAiSlug(service.id, transport)
  );
  return {
    apiName: saved?.apiName || "",
    key: saved?.key || "",
    model: saved?.model ?? service.model,
    url: service.id === "custom" ? saved?.url || service.url : service.url,
    preferences: saved?.learningAi?.preferences || "",
  };
}

function OfficialLink({ href, children }) {
  if (!href) return null;
  return (
    <Link href={href} target="_blank" rel="noopener noreferrer" variant="body2">
      {children}
    </Link>
  );
}

export default function AiServices() {
  const { setting, updateSetting } = useSetting();
  const rules = useRules();
  const [providerId, setProviderId] = useState(AI_SERVICES[0].id);
  const [transport, setTransport] = useState("api");
  const [drafts, setDrafts] = useState({});
  const [notice, setNotice] = useState(null);
  const [testResult, setTestResult] = useState("");
  const [testing, setTesting] = useState(false);
  const testController = useRef(null);
  const service =
    AI_SERVICES.find((item) => item.id === providerId) || CUSTOM_AI_SERVICE;
  const slug = getLearningAiSlug(providerId, transport);
  const form =
    drafts[slug] || initialDraft(service, transport, setting.transApis || []);
  const isWebMode = transport === "web";
  const savedApi = setting.transApis?.find((api) => api.apiSlug === slug);
  const webDraftSaved =
    !isWebMode ||
    (savedApi?.learningAi?.transport === "web" &&
      savedApi.learningAi.providerId === providerId &&
      savedApi.learningAi.preferences === form.preferences &&
      savedApi.apiName ===
        (form.apiName.trim() || `${service.name} · 后台网页`));
  const isOffline = setting.networkPolicy === "offline";
  const cloudBlocked = isOffline && (isWebMode || providerId !== "custom");
  const activeGlobally = rules.list?.some(
    (rule) => rule.pattern === "*" && rule.apiSlug === slug
  );

  useEffect(() => () => testController.current?.abort(), []);

  const clearFeedback = () => {
    setNotice(null);
    setTestResult("");
  };
  const chooseService = (next) => {
    setProviderId(next.id);
    if (!next.webSupported) setTransport("api");
    clearFeedback();
  };
  const changeField = (field) => (event) => {
    setDrafts((previous) => ({
      ...previous,
      [slug]: { ...form, [field]: event.target.value },
    }));
    clearFeedback();
  };
  const buildApiDraft = () =>
    buildLearningAiApi({ providerId, transport, ...form });
  const reportError = (error) => {
    let message = error?.message || "操作未完成，请检查配置后重试。";
    const key = form.key.trim();
    if (key) message = message.split(key).join("[已隐藏密钥]");
    setNotice({ severity: "error", text: message });
  };
  const saveApi = (api) => {
    updateSetting((previous) => ({
      ...previous,
      transApis: upsertLearningAiApi(previous.transApis || [], api),
    }));
  };
  const handleSave = () => {
    clearFeedback();
    try {
      saveApi(buildApiDraft());
      setNotice({
        severity: "success",
        text: "服务已保存。可在网页翻译的服务列表中选择它。",
      });
    } catch (error) {
      reportError(error);
    }
  };
  const handleUseGlobally = () => {
    clearFeedback();
    try {
      const api = buildApiDraft();
      saveApi(api);
      rules.put("*", { apiSlug: api.apiSlug });
      setNotice({
        severity: "success",
        text: "已保存并设为全局网页翻译服务。单独设置过服务的网站仍遵循其规则。",
      });
    } catch (error) {
      reportError(error);
    }
  };
  const handleTest = async () => {
    clearFeedback();
    const controller = new AbortController();
    testController.current = controller;
    try {
      if (isWebMode && !isExt)
        throw new Error("后台网页翻译需要安装浏览器扩展。");
      if (!webDraftSaved)
        throw new Error("请先保存当前网页翻译配置，再进行测试。");
      const apiSetting = buildApiDraft();
      applyNetworkPolicy(apiSetting.url, {}, setting.networkPolicy || "normal");
      setTesting(true);
      const { trText } = await apiTranslate({
        text: AI_SERVICE_TEST_TEXT,
        fromLang: "en",
        toLang: "zh-CN",
        apiSetting,
        useCache: false,
        usePool: false,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!trText) throw new Error("服务返回了空译文，请检查模型和接口配置。");
      setTestResult(trText);
      setNotice({
        severity: "success",
        text: isWebMode
          ? "已完成当前保存配置的测试，译文如下。"
          : "测试完成，译文如下。配置尚需点击保存。",
      });
    } catch (error) {
      if (!controller.signal.aborted) reportError(error);
    } finally {
      if (!controller.signal.aborted) setTesting(false);
    }
  };

  return (
    <Stack spacing={3}>
      <FreeApiTrial />
      <Alert severity="info">
        选择服务，填好配置后保存。免费网页、API
        试用额度与免费模型是不同权益；具体额度和价格以服务商当前说明为准。
      </Alert>
      <Box component="section" aria-label="选择 AI 服务">
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 1.5,
          }}
        >
          {AI_SERVICES.map((item) => (
            <Card
              key={item.id}
              variant="outlined"
              sx={{
                borderColor:
                  item.id === providerId ? "primary.main" : "divider",
                borderWidth: item.id === providerId ? 2 : 1,
                borderRadius: 3,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <CardActionArea
                onClick={() => chooseService(item)}
                disabled={testing}
                aria-label={`选择 ${item.name}`}
                aria-pressed={item.id === providerId}
                sx={{ p: 2, flexGrow: 1, alignItems: "start" }}
              >
                <Stack spacing={1} alignItems="flex-start">
                  <Typography variant="subtitle1" fontWeight={650}>
                    {item.name}
                  </Typography>
                  <Chip
                    label={item.badge}
                    size="small"
                    color={item.id === providerId ? "primary" : "default"}
                    variant="outlined"
                  />
                  <Typography variant="body2" color="text.secondary">
                    {item.billingNote}
                  </Typography>
                </Stack>
              </CardActionArea>
              <Stack
                direction="row"
                spacing={2}
                sx={{ px: 2, pb: 1.5, pt: 0.5 }}
              >
                <OfficialLink href={item.docsUrl}>API 文档</OfficialLink>
                <OfficialLink href={item.pricingUrl}>价格 / 额度</OfficialLink>
                <OfficialLink href={item.webUrl}>官网</OfficialLink>
              </Stack>
            </Card>
          ))}
        </Box>
        <Button
          variant={providerId === "custom" ? "contained" : "outlined"}
          onClick={() => chooseService(CUSTOM_AI_SERVICE)}
          disabled={testing}
          aria-pressed={providerId === "custom"}
          sx={{ mt: 2 }}
        >
          自定义兼容 API
        </Button>
      </Box>

      <Card
        variant="outlined"
        component="section"
        sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3 }}
        aria-label="配置 AI 翻译"
      >
        <Stack spacing={2.5}>
          <Stack
            direction="row"
            spacing={1.5}
            alignItems="center"
            useFlexGap
            flexWrap="wrap"
          >
            <AutoAwesomeRoundedIcon color="primary" />
            <Typography component="h2" variant="h6">
              {service.name}
            </Typography>
            {activeGlobally && (
              <Chip size="small" color="success" label="当前全局服务" />
            )}
          </Stack>
          <Box sx={testing ? { pointerEvents: "none", opacity: 0.6 } : {}}>
            <SettingsSegmented
              label="接入方式"
              value={transport}
              onChange={(next) => {
                if (!testing) {
                  setTransport(next);
                  clearFeedback();
                }
              }}
              items={[
                { value: "api", label: "API 接口", disabled: testing },
                {
                  value: "web",
                  label: "后台网页 · 实验性",
                  disabled: testing || !service.webSupported,
                },
              ]}
            />
          </Box>
          {isWebMode ? (
            <Stack spacing={1.5}>
              <Alert severity="warning">
                使用同一浏览器中已登录的 {service.name}{" "}
                网页，在后台标签提交翻译，不切换当前页面。登录、验证码和访问限制需要你手动处理；网页改版可能使适配失效。
                <br />
                无需 API Key，不提取 Cookie。网页用量及会员权益以官网为准，与
                API 计费独立。
              </Alert>
              {!isExt && (
                <Alert severity="info">
                  当前是网页演示环境，需安装 Chrome / Edge
                  扩展才能测试后台网页翻译。
                </Alert>
              )}
              {!webDraftSaved && (
                <Alert severity="info">
                  网页测试使用已保存的服务和翻译偏好。请先保存当前配置，再点击测试。
                </Alert>
              )}
              <Box>
                <Button
                  component="a"
                  href={service.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="outlined"
                >
                  打开官网并登录
                </Button>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  sx={{ mt: 0.75 }}
                >
                  此按钮只打开官网；不会填入或发送任何文本。
                </Typography>
              </Box>
            </Stack>
          ) : (
            <>
              <TextField
                label={
                  providerId === "custom"
                    ? "API 地址（Base URL 或完整地址）"
                    : "API 地址"
                }
                value={form.url}
                onChange={changeField("url")}
                fullWidth
                disabled={testing}
                InputProps={{ readOnly: providerId !== "custom" }}
                helperText={
                  providerId === "custom"
                    ? "例如 https://example.com/v1；自动补全 /chat/completions。本机服务可使用 HTTP。"
                    : "此预设使用官方地址；其他地区或代理服务请选自定义兼容 API。"
                }
                inputProps={{ "aria-label": "API 地址" }}
              />
              <TextField
                label="API Key"
                type="password"
                value={form.key}
                onChange={changeField("key")}
                autoComplete="new-password"
                fullWidth
                disabled={testing}
                helperText="使用 API 平台提供的密钥；免费模型通常也需要 Key。本机无鉴权服务可留空。"
                inputProps={{ "aria-label": "API Key" }}
              />
              <TextField
                label="模型 / 接入点 ID"
                value={form.model}
                onChange={changeField("model")}
                fullWidth
                disabled={testing}
                helperText={
                  service.modelHint ||
                  "可修改为账户已开通的模型；更换模型前请确认参数兼容性和价格。"
                }
                inputProps={{
                  maxLength: 200,
                  "aria-label": "模型 / 接入点 ID",
                }}
              />
            </>
          )}
          <TextField
            label="服务名称（可选）"
            value={form.apiName}
            onChange={changeField("apiName")}
            fullWidth
            disabled={testing}
            placeholder={`${service.name} · ${isWebMode ? "后台网页" : "AI 翻译"}`}
            inputProps={{ "aria-label": "服务名称（可选）" }}
          />
          <TextField
            label="翻译偏好与术语"
            value={form.preferences}
            onChange={changeField("preferences")}
            multiline
            minRows={3}
            fullWidth
            disabled={testing}
            placeholder="例如：使用简体中文，语气自然；将 workspace 译为工作区，API 保持英文。"
            helperText={`${form.preferences.length} / ${TRANSLATION_SKILL_LIMITS.preferences} 字符。偏好仅影响措辞，固定翻译规则优先。`}
            inputProps={{
              maxLength: TRANSLATION_SKILL_LIMITS.preferences,
              "aria-label": "翻译偏好与术语",
            }}
          />
          <Box
            component="details"
            sx={{ color: "text.secondary", fontSize: 14 }}
          >
            <Box component="summary" sx={{ cursor: "pointer" }}>
              查看固定翻译 Skill
            </Box>
            <Typography variant="body2" sx={{ mt: 1 }}>
              只输出译文、保留格式和占位符、将网页里的指令当作待译内容。模型表现仍需检查。
            </Typography>
            <Typography
              component="pre"
              variant="caption"
              sx={{
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                maxHeight: 300,
                overflow: "auto",
              }}
            >
              {TRANSLATION_SKILL_CORE}
            </Typography>
          </Box>
          {isOffline && (
            <Alert severity="warning">
              当前联网策略为“仅本机离线”。云 API
              和后台网页翻译已受限；可配置本机兼容
              API，或自行在常规设置中更改联网策略。
            </Alert>
          )}
          <Box sx={{ bgcolor: "action.hover", p: 2, borderRadius: 2 }}>
            <Typography variant="body2">
              测试只在点击按钮后发送以下固定句子（英文 →
              简体中文），可能消耗服务额度：
            </Typography>
            <Typography variant="body2" sx={{ mt: 1, fontStyle: "italic" }}>
              {AI_SERVICE_TEST_TEXT}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap">
            <Button variant="contained" onClick={handleSave} disabled={testing}>
              保存服务
            </Button>
            <Button
              variant="outlined"
              onClick={handleTest}
              disabled={
                testing ||
                cloudBlocked ||
                !webDraftSaved ||
                (isWebMode && !isExt)
              }
            >
              {testing ? "正在测试…" : isWebMode ? "测试后台网页" : "测试接口"}
            </Button>
            <Button
              onClick={handleUseGlobally}
              disabled={testing || rules.isLoading}
            >
              设为全局服务
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            保存不会发送测试句；“设为全局服务”会同时保存当前配置。联网策略保持原设置。
          </Typography>
          {notice && (
            <Alert severity={notice.severity} role="status">
              {notice.text}
            </Alert>
          )}
          {testResult && (
            <Box
              component="output"
              aria-label="测试译文"
              sx={{
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                p: 2,
                border: 1,
                borderColor: "divider",
                borderRadius: 2,
              }}
            >
              {testResult}
            </Box>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
