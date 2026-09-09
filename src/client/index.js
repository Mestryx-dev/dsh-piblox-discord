window.__ModuleLoader__.load({
  id: "dsh-piblox-discord",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    let react = require("react");
    let jsxRuntime = require("react/jsx-runtime");
    let jsx = jsxRuntime.jsx;
    let jsxs = jsxRuntime.jsxs;
    let useState = react.useState;
    let useEffect = react.useEffect;
    let useCallback = react.useCallback;
    let useId = react.useId || (() => "dsh-discord-" + Math.random().toString(36).slice(2, 9));

    const SECTION_ID = "discord";
    const LOCALE_NS = "settings.discord";
    const API = "/api/discord";

    // Common intents stay expanded; remaining intents collapse under Advanced.
    // Keep in sync with src/client/ui-model.js COMMON_INTENT_IDS.
    const COMMON_INTENT_IDS = ["Guilds", "GuildMessages", "DirectMessages", "MessageContent"];

    /**
     * Visual language mirrors @deepseek-ai/dsh-client-ui-primitives (Button / Pill / Input)
     * and ui-settings-plugins fields.module.css via --dsw-alias-* tokens.
     * Plugin ModuleLoader clients cannot import CSS modules from those packages.
     */
    const css = {
      page: {
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
        maxWidth: "40rem",
        color: "var(--dsw-alias-label-primary, inherit)",
      },
      title: {
        margin: 0,
        fontSize: "1.25rem",
        letterSpacing: "-0.02em",
        color: "var(--dsw-alias-label-primary, inherit)",
      },
      subtitle: {
        margin: "0.25rem 0 0",
        fontSize: "0.9rem",
        lineHeight: 1.4,
        color: "var(--dsw-alias-label-secondary, inherit)",
        opacity: 0.9,
      },
      section: {
        display: "flex",
        flexDirection: "column",
        gap: "0.65rem",
        padding: "0.85rem 0",
        borderTop: "0.5px solid var(--dsw-alias-border-l2, color-mix(in oklab, CanvasText 12%, transparent))",
      },
      sectionFirst: {
        display: "flex",
        flexDirection: "column",
        gap: "0.65rem",
        padding: "0.25rem 0 0.85rem",
      },
      sectionTitle: {
        margin: 0,
        fontSize: "13px",
        fontWeight: 600,
        lineHeight: 1.5,
        color: "var(--dsw-alias-label-primary, inherit)",
      },
      field: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
      },
      label: {
        fontSize: "13px",
        fontWeight: 500,
        lineHeight: 1.5,
        color: "var(--dsw-alias-label-primary, inherit)",
      },
      hint: {
        margin: 0,
        fontSize: "12px",
        lineHeight: 1.5,
        color: "var(--dsw-alias-label-tertiary, inherit)",
        opacity: 0.95,
      },
      input: {
        height: "34px",
        padding: "0 12px",
        boxSizing: "border-box",
        width: "100%",
        border: "0.5px solid var(--dsw-alias-border-l4, color-mix(in oklab, CanvasText 18%, transparent))",
        borderRadius: "8px",
        background: "var(--dsw-alias-bg-layer-3, transparent)",
        font: "inherit",
        fontSize: "13px",
        lineHeight: 1.5,
        color: "var(--dsw-alias-label-primary, inherit)",
      },
      textarea: {
        minHeight: "4.5rem",
        padding: "8px 12px",
        boxSizing: "border-box",
        width: "100%",
        border: "0.5px solid var(--dsw-alias-border-l4, color-mix(in oklab, CanvasText 18%, transparent))",
        borderRadius: "8px",
        background: "var(--dsw-alias-bg-layer-3, transparent)",
        font: "inherit",
        fontSize: "13px",
        lineHeight: 1.5,
        color: "var(--dsw-alias-label-primary, inherit)",
        resize: "vertical",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      },
      checkRow: {
        display: "flex",
        gap: "0.5rem",
        alignItems: "flex-start",
        fontSize: "13px",
        lineHeight: 1.45,
        color: "var(--dsw-alias-label-primary, inherit)",
      },
      btnPrimary: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "4px",
        height: "36px",
        padding: "0 14px",
        border: "none",
        borderRadius: "18px",
        cursor: "pointer",
        fontSize: "14px",
        lineHeight: "22px",
        background: "var(--dsw-alias-button-primary-fill, CanvasText)",
        color: "var(--dsw-alias-label-primary-foreground, Canvas)",
      },
      btnOutline: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "4px",
        height: "36px",
        padding: "0 14px",
        borderRadius: "18px",
        cursor: "pointer",
        fontSize: "14px",
        lineHeight: "22px",
        border: "0.5px solid var(--dsw-alias-border-l3, color-mix(in oklab, CanvasText 22%, transparent))",
        background: "transparent",
        color: "var(--dsw-alias-label-primary, inherit)",
      },
      btnSm: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: "28px",
        padding: "0 10px",
        borderRadius: "14px",
        cursor: "pointer",
        fontSize: "12px",
        lineHeight: "18px",
        border: "0.5px solid var(--dsw-alias-border-l3, color-mix(in oklab, CanvasText 22%, transparent))",
        background: "transparent",
        color: "var(--dsw-alias-label-primary, inherit)",
      },
      btnDanger: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "4px",
        height: "36px",
        padding: "0 14px",
        border: "none",
        borderRadius: "18px",
        cursor: "pointer",
        fontSize: "14px",
        lineHeight: "22px",
        background: "var(--dsw-alias-label-error, tomato)",
        color: "var(--dsw-alias-label-primary-foreground, Canvas)",
      },
      btnDangerSm: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: "28px",
        padding: "0 10px",
        borderRadius: "14px",
        cursor: "pointer",
        fontSize: "12px",
        lineHeight: "18px",
        border: "0.5px solid color-mix(in oklab, var(--dsw-alias-label-error, tomato) 40%, transparent)",
        background: "transparent",
        color: "var(--dsw-alias-label-error, tomato)",
      },
      btnAdd: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "4px",
        height: "36px",
        padding: "0 14px",
        borderRadius: "18px",
        cursor: "pointer",
        fontSize: "14px",
        lineHeight: "22px",
        border: "0.5px solid var(--dsw-alias-border-l3, color-mix(in oklab, CanvasText 22%, transparent))",
        background: "transparent",
        color: "var(--dsw-alias-label-primary, inherit)",
        flex: "0 0 auto",
        whiteSpace: "nowrap",
      },
      pill: {
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        height: "24px",
        padding: "0 8px",
        borderRadius: "12px",
        fontSize: "12px",
        lineHeight: "18px",
        color: "var(--dsw-alias-label-secondary, inherit)",
        background: "var(--dsw-alias-bg-layer-2, color-mix(in oklab, Canvas 92%, CanvasText 8%))",
        whiteSpace: "nowrap",
      },
      pillWarn: {
        color: "var(--dsw-alias-label-warning, #b45309)",
        background: "color-mix(in oklab, var(--dsw-alias-label-warning, #b45309) 14%, transparent)",
      },
      pillError: {
        color: "var(--dsw-alias-label-error, tomato)",
        background: "color-mix(in oklab, var(--dsw-alias-label-error, tomato) 14%, transparent)",
      },
      pillOk: {
        color: "var(--dsw-alias-label-success, #15803d)",
        background: "color-mix(in oklab, var(--dsw-alias-label-success, #15803d) 14%, transparent)",
      },
      card: {
        padding: "0.85rem 0.9rem",
        borderRadius: "12px",
        border: "0.5px solid var(--dsw-alias-border-l2, color-mix(in oklab, CanvasText 12%, transparent))",
        background: "var(--dsw-alias-bg-layer-2, color-mix(in oklab, Canvas 92%, CanvasText 8%))",
        display: "flex",
        flexDirection: "column",
        gap: "0.55rem",
      },
      error: {
        margin: 0,
        fontSize: "12px",
        lineHeight: 1.5,
        color: "var(--dsw-alias-label-error, tomato)",
      },
      row: {
        display: "flex",
        gap: "0.5rem",
        flexWrap: "wrap",
        alignItems: "center",
      },
      metaRow: {
        display: "grid",
        gridTemplateColumns: "5.5rem 1fr",
        gap: "0.25rem 0.75rem",
        fontSize: "12px",
        lineHeight: 1.45,
        color: "var(--dsw-alias-label-secondary, inherit)",
      },
      metaKey: {
        color: "var(--dsw-alias-label-tertiary, inherit)",
      },
      headerBar: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "0.75rem 1rem",
        flexWrap: "wrap",
      },
      headerText: {
        flex: "1 1 12rem",
        minWidth: 0,
      },
      actionsBar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.5rem",
        flexWrap: "wrap",
      },
      actionsLeft: {
        display: "flex",
        gap: "0.4rem",
        flexWrap: "wrap",
        alignItems: "center",
      },
      modalRoot: {
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      },
      modalMask: {
        position: "absolute",
        inset: 0,
        background: "var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.24))",
        backdropFilter: "var(--dsw-mask-blur, blur(2px))",
      },
      modalDialog: {
        position: "relative",
        zIndex: 1,
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        width: "min(380px, 100%)",
        padding: "22px 24px 20px",
        borderRadius: "24px",
        background: "var(--dsw-alias-bg-layer-2, Canvas)",
        boxShadow: "var(--dsw-elevation-prominent, 0 12px 40px rgba(0,0,0,0.18))",
        color: "var(--dsw-alias-label-primary, inherit)",
      },
      modalTitle: {
        margin: 0,
        fontSize: "16px",
        lineHeight: "24px",
        fontWeight: 500,
      },
      modalBody: {
        margin: 0,
        fontSize: "14px",
        lineHeight: "22px",
        color: "var(--dsw-alias-label-primary, inherit)",
      },
      modalFooter: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: "0.5rem",
        flexWrap: "wrap",
      },
      details: {
        border: "0.5px solid var(--dsw-alias-border-l2, color-mix(in oklab, CanvasText 12%, transparent))",
        borderRadius: "8px",
        padding: "0.5rem 0.75rem",
      },
      detailsSummary: {
        cursor: "pointer",
        fontSize: "13px",
        fontWeight: 500,
        color: "var(--dsw-alias-label-primary, inherit)",
      },
    };

    const DICT = {
      en: {
        nav: "Discord",
        title: "Discord accounts",
        subtitle: "Multi-account Discord provider. Bot tokens live in Secrets — never in this config.",
        empty: "No Discord accounts yet.",
        add: "Add account",
        edit: "Edit",
        save: "Save",
        cancel: "Cancel",
        delete: "Delete account",
        enable: "Enabled",
        accountId: "Account ID",
        accountIdHint: "lowercase_snake (e.g. lab, infra)",
        label: "Display label",
        token: "Bot token",
        tokenConfigured: "Configured",
        tokenMissing: "Not configured",
        replaceToken: "Replace token",
        removeToken: "Remove token",
        confirmRemoveToken: "Remove bot token for this account? The account stays configured.",
        confirmDeleteTitle: 'Delete Discord account "{id}"?',
        confirmDeleteBody:
          "The account configuration will be removed. ConversationBinding and delivery history are retained.",
        deleteSecretToo: "Also delete {secret} from Secrets",
        deleteSecretHint: "Unchecked keeps the secret in Settings → Secrets.",
        closeDialog: "Close",
        sectionGeneral: "General",
        sectionIntents: "Gateway intents",
        sectionGuilds: "Guild access",
        sectionChannels: "Channel access",
        sectionDm: "Direct messages",
        sectionBehavior: "Behavior",
        advancedIntents: "Advanced intents",
        allowAllGuilds: "Allow all guilds",
        allowAllChannels: "Allow all channels",
        allowAllUsers: "Allow all DM users",
        allowedGuilds: "Allowed guild IDs",
        allowedChannels: "Allowed channel IDs",
        dmEnabled: "Enable DMs",
        dmUsers: "Allowed DM user IDs",
        emptyDenyAll: "Empty list = deny all",
        ignoreBots: "Ignore bot messages",
        privileged: "privileged",
        status: "Status",
        statusLine: "Status",
        tokenLine: "Token",
        guildsLine: "Guilds",
        channelsLine: "Channels",
        dmsLine: "DMs",
        loading: "Loading…",
        error: "Something went wrong",
        snowflakeHint:
          "One ID per line: 17–20 digit snowflake (Developer Mode → Copy ID). Channel/guild URLs OK.",
        snowflakeInvalid:
          "Invalid Discord ID. Use 17–20 digit snowflakes only (no names, no short numbers).",
        scopeAllowAll: "allow all",
        scopeDenyAll: "deny all",
        scopeDisabled: "disabled",
        scopeAllowAllUsers: "allow all users",
      },
    };

    function tBound(ctx) {
      try {
        return ctx.locale.bind(LOCALE_NS);
      } catch {
        return (key) => DICT.en[key] || key;
      }
    }

    async function api(path, init) {
      const res = await fetch(API + path, {
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...(init && init.headers) },
        ...init,
      });
      if (res.status === 204) return { ok: true };
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data && data.error) || res.statusText);
      return data;
    }

    function linesToList(text) {
      return String(text || "")
        .split(/[\n,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    /** Extract / validate Discord snowflake decimal strings (17–20 digits). */
    function coerceSnowflake(raw) {
      const s = String(raw || "").trim().replace(/^["']|["']$/g, "");
      if (/^\d{17,20}$/.test(s)) return s;
      // discord.com/channels/<guild>/<channel>[/...]
      const m = s.match(/channels\/(\d{17,20})(?:\/(\d{17,20}))?/);
      if (m) return m[2] || m[1];
      return null;
    }

    function linesToSnowflakes(text) {
      const out = [];
      for (const part of linesToList(text)) {
        const id = coerceSnowflake(part);
        if (!id) {
          const err = new Error(
            "Invalid Discord ID \"" +
              part.slice(0, 48) +
              "\". Use 17–20 digit snowflakes (Developer Mode → Copy ID).",
          );
          err.code = "snowflake";
          throw err;
        }
        if (!out.includes(id)) out.push(id);
      }
      return out;
    }

    function listToLines(list) {
      return (list || []).join("\n");
    }

    function partitionIntents(intents) {
      const list = Array.isArray(intents) ? intents : [];
      const commonIds = new Set(COMMON_INTENT_IDS);
      const common = [];
      const advanced = [];
      for (const intent of list) {
        if (commonIds.has(intent.id)) common.push(intent);
        else advanced.push(intent);
      }
      common.sort((a, b) => COMMON_INTENT_IDS.indexOf(a.id) - COMMON_INTENT_IDS.indexOf(b.id));
      return { common: common, advanced: advanced };
    }

    function formatScope(kind, code, t) {
      const c = code || "deny_all";
      if (kind === "dm") {
        if (c === "disabled") return t("scopeDisabled");
        if (c === "all_users") return t("scopeAllowAllUsers");
        if (c === "deny_all") return t("scopeDenyAll");
        if (String(c).endsWith("_users")) return String(c).replace(/_users$/, "") + " users";
        return c;
      }
      if (c === "all") return t("scopeAllowAll");
      if (c === "deny_all") return t("scopeDenyAll");
      return c + " listed";
    }

    function statusPillStyle(status) {
      if (status === "connected") return { ...css.pill, ...css.pillOk };
      if (status === "missing_credentials" || status === "rate_limited") return { ...css.pill, ...css.pillWarn };
      if (status === "failed_auth" || status === "error") return { ...css.pill, ...css.pillError };
      return css.pill;
    }

    /** Display-only: strip legacy " (no token)" suffix from older smoke labels. */
    function displayAccountTitle(item) {
      const id = (item && item.account_id) || "";
      let label = String((item && item.label) || "").trim();
      if (label.toLowerCase().endsWith("(no token)")) {
        label = label.replace(/\s*\(no token\)\s*$/i, "").trim();
      }
      return label || id;
    }

    function credentialSecretName(accountId) {
      return "DISCORD_" + String(accountId || "").toUpperCase() + "_BOT_TOKEN";
    }

    function deleteAccountQuery(deleteVaultSecret) {
      return deleteVaultSecret ? "?deleteSecret=true" : "";
    }

    function fillTemplate(template, vars) {
      return String(template || "").replace(/\{(\w+)\}/g, (_, key) =>
        vars[key] != null ? String(vars[key]) : "",
      );
    }

    function Field({ id, label, hint, children }) {
      return jsxs("div", {
        style: css.field,
        children: [
          jsx("label", { htmlFor: id, style: css.label, children: label }),
          children,
          hint ? jsx("p", { style: css.hint, children: hint }) : null,
        ],
      });
    }

    function Check({ id, checked, onChange, label }) {
      return jsxs("label", {
        htmlFor: id,
        style: css.checkRow,
        children: [
          jsx("input", {
            id: id,
            type: "checkbox",
            checked: checked,
            onChange: onChange,
            style: { marginTop: "0.15rem" },
          }),
          jsx("span", { children: label }),
        ],
      });
    }

    function Section({ title, first, children }) {
      return jsxs("section", {
        style: first ? css.sectionFirst : css.section,
        children: [
          jsx("h3", { style: css.sectionTitle, children: title }),
          children,
        ],
      });
    }

    function IntentChecks({ intents, selected, onToggle, idPrefix, t }) {
      return jsx("div", {
        style: { display: "flex", flexDirection: "column", gap: "0.35rem" },
        children: intents.map((intent) =>
          jsxs(
            "label",
            {
              htmlFor: idPrefix + "-" + intent.id,
              style: css.checkRow,
              children: [
                jsx("input", {
                  id: idPrefix + "-" + intent.id,
                  type: "checkbox",
                  checked: selected.has(intent.id),
                  onChange: () => onToggle(intent.id),
                  style: { marginTop: "0.15rem" },
                }),
                jsxs("span", {
                  children: [
                    intent.label,
                    intent.privileged
                      ? jsx("span", {
                          style: {
                            marginLeft: "0.4rem",
                            ...css.pill,
                            height: "20px",
                            fontSize: "11px",
                          },
                          children: t("privileged"),
                        })
                      : null,
                  ],
                }),
              ],
            },
            intent.id,
          ),
        ),
      });
    }

    function AccountForm({ initial, meta, t, onCancel, onSaved }) {
      const isNew = !initial;
      const baseId = useId();
      const [accountId, setAccountId] = useState(initial ? initial.account_id : "");
      const [label, setLabel] = useState(initial ? initial.label || "" : "");
      const [enabled, setEnabled] = useState(initial ? initial.enabled : true);
      const [token, setToken] = useState("");
      const [replacing, setReplacing] = useState(false);
      const [allowAllGuilds, setAllowAllGuilds] = useState(initial ? initial.allowAllGuilds : false);
      const [allowAllChannels, setAllowAllChannels] = useState(
        initial ? initial.allowAllChannels : false,
      );
      const [guilds, setGuilds] = useState(listToLines(initial && initial.allowedGuilds));
      const [channels, setChannels] = useState(listToLines(initial && initial.allowedChannels));
      const [dmEnabled, setDmEnabled] = useState(initial ? initial.dm && initial.dm.enabled : false);
      const [allowAllUsers, setAllowAllUsers] = useState(
        initial ? initial.dm && initial.dm.allowAllUsers : false,
      );
      const [dmUsers, setDmUsers] = useState(
        listToLines(initial && initial.dm && initial.dm.allowedUsers),
      );
      const [ignoreBots, setIgnoreBots] = useState(initial ? initial.ignoreBots !== false : true);
      const [intents, setIntents] = useState(
        new Set(
          (initial && initial.intents) ||
            (meta.intents || []).filter((i) => i.default).map((i) => i.id),
        ),
      );
      const [busy, setBusy] = useState(false);
      const [err, setErr] = useState("");

      const partitioned = partitionIntents(meta.intents || []);
      const tokenConfigured = Boolean(initial && initial.credentials && initial.credentials.configured);

      function toggleIntent(id) {
        setIntents((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      }

      async function onSubmit(e) {
        e.preventDefault();
        setBusy(true);
        setErr("");
        try {
          const body = {
            label: label || undefined,
            enabled,
            intents: [...intents],
            allowAllGuilds,
            allowAllChannels,
            allowedGuilds: allowAllGuilds ? [] : linesToSnowflakes(guilds),
            allowedChannels: allowAllChannels ? [] : linesToSnowflakes(channels),
            dm: {
              enabled: dmEnabled,
              allowAllUsers: dmEnabled ? allowAllUsers : false,
              allowedUsers: !dmEnabled || allowAllUsers ? [] : linesToSnowflakes(dmUsers),
            },
            ignoreBots,
          };
          if (isNew) {
            const id = accountId.trim();
            if (!/^[a-z][a-z0-9_]{0,47}$/.test(id)) {
              throw new Error(t("accountIdHint"));
            }
            await api("/accounts", {
              method: "POST",
              body: JSON.stringify({
                account_id: id,
                token: token || undefined,
                ...body,
              }),
            });
          } else {
            await api("/accounts/" + encodeURIComponent(initial.account_id), {
              method: "PATCH",
              body: JSON.stringify(body),
            });
            if (replacing && token) {
              await api("/accounts/" + encodeURIComponent(initial.account_id) + "/credential", {
                method: "POST",
                body: JSON.stringify({ token }),
              });
            }
          }
          onSaved();
        } catch (ex) {
          setErr((ex && ex.message) || t("error"));
        } finally {
          setBusy(false);
        }
      }

      async function onRemoveToken() {
        if (!initial) return;
        if (!confirm(t("confirmRemoveToken"))) return;
        setBusy(true);
        setErr("");
        try {
          await api("/accounts/" + encodeURIComponent(initial.account_id) + "/credential", {
            method: "DELETE",
          });
          setReplacing(false);
          setToken("");
          onSaved();
        } catch (ex) {
          setErr((ex && ex.message) || t("error"));
        } finally {
          setBusy(false);
        }
      }

      return jsxs("form", {
        onSubmit: onSubmit,
        style: css.page,
        "aria-label": isNew ? t("add") : t("edit"),
        children: [
          jsx(Section, {
            title: t("sectionGeneral"),
            first: true,
            children: jsxs("div", {
              style: { display: "flex", flexDirection: "column", gap: "0.65rem" },
              children: [
                isNew
                  ? jsx(Field, {
                      id: baseId + "-accountId",
                      label: t("accountId"),
                      hint: t("accountIdHint"),
                      children: jsx("input", {
                        id: baseId + "-accountId",
                        required: true,
                        value: accountId,
                        placeholder: "lab",
                        autoComplete: "off",
                        spellCheck: false,
                        onChange: (ev) => setAccountId(ev.target.value),
                        style: css.input,
                      }),
                    })
                  : jsxs("div", {
                      style: css.field,
                      children: [
                        jsx("div", { style: css.label, children: t("accountId") }),
                        jsx("code", { style: { fontSize: "13px" }, children: initial.account_id }),
                      ],
                    }),
                jsx(Field, {
                  id: baseId + "-label",
                  label: t("label"),
                  children: jsx("input", {
                    id: baseId + "-label",
                    value: label,
                    onChange: (ev) => setLabel(ev.target.value),
                    style: css.input,
                  }),
                }),
                jsx(Check, {
                  id: baseId + "-enabled",
                  checked: enabled,
                  onChange: (ev) => setEnabled(ev.target.checked),
                  label: t("enable"),
                }),
                isNew
                  ? jsx(Field, {
                      id: baseId + "-token",
                      label: t("token"),
                      children: jsx("input", {
                        id: baseId + "-token",
                        type: "password",
                        value: token,
                        autoComplete: "new-password",
                        onChange: (ev) => setToken(ev.target.value),
                        style: css.input,
                      }),
                    })
                  : jsxs("div", {
                      style: { display: "flex", flexDirection: "column", gap: "0.45rem" },
                      children: [
                        jsxs("div", {
                          style: css.row,
                          children: [
                            jsx("span", { style: css.label, children: t("token") + ":" }),
                            jsx("span", {
                              style: tokenConfigured ? { ...css.pill, ...css.pillOk } : css.pill,
                              children: tokenConfigured ? t("tokenConfigured") : t("tokenMissing"),
                            }),
                          ],
                        }),
                        jsxs("div", {
                          style: css.row,
                          children: [
                            !replacing
                              ? jsx("button", {
                                  type: "button",
                                  style: css.btnSm,
                                  onClick: () => setReplacing(true),
                                  children: t("replaceToken"),
                                })
                              : jsx(Field, {
                                  id: baseId + "-token-replace",
                                  label: t("token"),
                                  children: jsx("input", {
                                    id: baseId + "-token-replace",
                                    type: "password",
                                    value: token,
                                    autoComplete: "new-password",
                                    onChange: (ev) => setToken(ev.target.value),
                                    style: css.input,
                                  }),
                                }),
                            tokenConfigured
                              ? jsx("button", {
                                  type: "button",
                                  style: css.btnSm,
                                  onClick: () => void onRemoveToken(),
                                  disabled: busy,
                                  children: t("removeToken"),
                                })
                              : null,
                          ],
                        }),
                      ],
                    }),
              ],
            }),
          }),

          jsx(Section, {
            title: t("sectionIntents"),
            children: jsxs("div", {
              style: { display: "flex", flexDirection: "column", gap: "0.65rem" },
              children: [
                jsx(IntentChecks, {
                  intents: partitioned.common,
                  selected: intents,
                  onToggle: toggleIntent,
                  idPrefix: baseId + "-intent",
                  t: t,
                }),
                partitioned.advanced.length
                  ? jsxs("details", {
                      style: css.details,
                      children: [
                        jsx("summary", {
                          style: css.detailsSummary,
                          children: t("advancedIntents"),
                        }),
                        jsx("div", {
                          style: { marginTop: "0.55rem" },
                          children: jsx(IntentChecks, {
                            intents: partitioned.advanced,
                            selected: intents,
                            onToggle: toggleIntent,
                            idPrefix: baseId + "-adv-intent",
                            t: t,
                          }),
                        }),
                      ],
                    })
                  : null,
              ],
            }),
          }),

          jsx(Section, {
            title: t("sectionGuilds"),
            children: jsxs("div", {
              style: { display: "flex", flexDirection: "column", gap: "0.55rem" },
              children: [
                jsx(Check, {
                  id: baseId + "-all-guilds",
                  checked: allowAllGuilds,
                  onChange: (ev) => setAllowAllGuilds(ev.target.checked),
                  label: t("allowAllGuilds"),
                }),
                !allowAllGuilds
                  ? jsx(Field, {
                      id: baseId + "-guilds",
                      label: t("allowedGuilds"),
                      hint: t("emptyDenyAll") + " · " + t("snowflakeHint"),
                      children: jsx("textarea", {
                        id: baseId + "-guilds",
                        value: guilds,
                        onChange: (ev) => setGuilds(ev.target.value),
                        rows: 3,
                        style: css.textarea,
                      }),
                    })
                  : null,
              ],
            }),
          }),

          jsx(Section, {
            title: t("sectionChannels"),
            children: jsxs("div", {
              style: { display: "flex", flexDirection: "column", gap: "0.55rem" },
              children: [
                jsx(Check, {
                  id: baseId + "-all-channels",
                  checked: allowAllChannels,
                  onChange: (ev) => setAllowAllChannels(ev.target.checked),
                  label: t("allowAllChannels"),
                }),
                !allowAllChannels
                  ? jsx(Field, {
                      id: baseId + "-channels",
                      label: t("allowedChannels"),
                      hint: t("emptyDenyAll") + " · " + t("snowflakeHint"),
                      children: jsx("textarea", {
                        id: baseId + "-channels",
                        value: channels,
                        onChange: (ev) => setChannels(ev.target.value),
                        rows: 3,
                        style: css.textarea,
                      }),
                    })
                  : null,
              ],
            }),
          }),

          jsx(Section, {
            title: t("sectionDm"),
            children: jsxs("div", {
              style: { display: "flex", flexDirection: "column", gap: "0.55rem" },
              children: [
                jsx(Check, {
                  id: baseId + "-dm-enabled",
                  checked: dmEnabled,
                  onChange: (ev) => setDmEnabled(ev.target.checked),
                  label: t("dmEnabled"),
                }),
                dmEnabled
                  ? jsxs("div", {
                      style: { display: "flex", flexDirection: "column", gap: "0.55rem" },
                      children: [
                        jsx(Check, {
                          id: baseId + "-dm-all",
                          checked: allowAllUsers,
                          onChange: (ev) => setAllowAllUsers(ev.target.checked),
                          label: t("allowAllUsers"),
                        }),
                        !allowAllUsers
                          ? jsx(Field, {
                              id: baseId + "-dm-users",
                              label: t("dmUsers"),
                              hint: t("emptyDenyAll") + " · " + t("snowflakeHint"),
                              children: jsx("textarea", {
                                id: baseId + "-dm-users",
                                value: dmUsers,
                                onChange: (ev) => setDmUsers(ev.target.value),
                                rows: 3,
                                style: css.textarea,
                              }),
                            })
                          : null,
                      ],
                    })
                  : jsx("p", { style: css.hint, children: t("scopeDisabled") }),
              ],
            }),
          }),

          jsx(Section, {
            title: t("sectionBehavior"),
            children: jsx(Check, {
              id: baseId + "-ignore-bots",
              checked: ignoreBots,
              onChange: (ev) => setIgnoreBots(ev.target.checked),
              label: t("ignoreBots"),
            }),
          }),

          jsxs("div", {
            style: css.row,
            children: [
              jsx("button", {
                type: "submit",
                disabled: busy,
                style: { ...css.btnPrimary, opacity: busy ? 0.4 : 1 },
                children: busy ? t("loading") : t("save"),
              }),
              jsx("button", {
                type: "button",
                style: css.btnOutline,
                onClick: onCancel,
                children: t("cancel"),
              }),
            ],
          }),
          err ? jsx("p", { role: "alert", style: css.error, children: err }) : null,
        ],
      });
    }

    function AccountCard({ item, t, onEdit, onDelete, onRemoveToken }) {
      const summary = item.scope_summary || {};
      const configured = Boolean(item.credentials && item.credentials.configured);
      const title = displayAccountTitle(item);
      return jsxs("article", {
        style: css.card,
        "aria-label": title || item.account_id,
        children: [
          jsxs("div", {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "0.75rem",
              flexWrap: "wrap",
            },
            children: [
              jsxs("div", {
                style: { minWidth: 0, flex: "1 1 10rem" },
                children: [
                  jsx("strong", {
                    style: {
                      display: "block",
                      fontSize: "14px",
                      color: "var(--dsw-alias-label-primary, inherit)",
                      overflowWrap: "anywhere",
                    },
                    children: title,
                  }),
                  jsx("div", {
                    style: {
                      fontSize: "12px",
                      color: "var(--dsw-alias-label-tertiary, inherit)",
                      overflowWrap: "anywhere",
                    },
                    children: item.account_id,
                  }),
                ],
              }),
              jsx("span", {
                style: statusPillStyle(item.status),
                children: item.status,
              }),
            ],
          }),
          jsxs("div", {
            style: css.metaRow,
            children: [
              jsx("span", { style: css.metaKey, children: t("tokenLine") }),
              jsx("span", {
                children: configured ? t("tokenConfigured") : t("tokenMissing"),
              }),
              jsx("span", { style: css.metaKey, children: t("guildsLine") }),
              jsx("span", { children: formatScope("guilds", summary.guilds, t) }),
              jsx("span", { style: css.metaKey, children: t("channelsLine") }),
              jsx("span", { children: formatScope("channels", summary.channels, t) }),
              jsx("span", { style: css.metaKey, children: t("dmsLine") }),
              jsx("span", { children: formatScope("dm", summary.dm, t) }),
            ],
          }),
          jsxs("div", {
            style: css.actionsBar,
            children: [
              jsxs("div", {
                style: css.actionsLeft,
                children: [
                  jsx("button", {
                    type: "button",
                    style: css.btnSm,
                    onClick: onEdit,
                    children: t("edit"),
                  }),
                  configured
                    ? jsx("button", {
                        type: "button",
                        style: css.btnDangerSm,
                        onClick: onRemoveToken,
                        children: t("removeToken"),
                      })
                    : null,
                ],
              }),
              jsx("button", {
                type: "button",
                style: css.btnDangerSm,
                onClick: onDelete,
                children: t("delete"),
              }),
            ],
          }),
        ],
      });
    }

    function DeleteAccountDialog({ account, t, busy, onCancel, onConfirm }) {
      const [deleteSecret, setDeleteSecret] = useState(false);
      const secretName = credentialSecretName(account.account_id);
      const title = fillTemplate(t("confirmDeleteTitle"), { id: account.account_id });
      const secretLabel = fillTemplate(t("deleteSecretToo"), { secret: secretName });
      const checkId = "delete-secret-confirm-" + account.account_id;

      return jsxs("div", {
        style: css.modalRoot,
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "discord-delete-title",
        children: [
          jsx("div", {
            style: css.modalMask,
            onClick: busy ? undefined : onCancel,
          }),
          jsxs("div", {
            style: css.modalDialog,
            children: [
              jsx("h3", {
                id: "discord-delete-title",
                style: css.modalTitle,
                children: title,
              }),
              jsx("p", { style: css.modalBody, children: t("confirmDeleteBody") }),
              jsxs("div", {
                style: { display: "flex", flexDirection: "column", gap: "0.35rem" },
                children: [
                  jsx(Check, {
                    id: checkId,
                    checked: deleteSecret,
                    onChange: (ev) => setDeleteSecret(Boolean(ev.target.checked)),
                    label: secretLabel,
                  }),
                  jsx("p", { style: css.hint, children: t("deleteSecretHint") }),
                ],
              }),
              jsxs("div", {
                style: css.modalFooter,
                children: [
                  jsx("button", {
                    type: "button",
                    style: css.btnOutline,
                    disabled: busy,
                    onClick: onCancel,
                    children: t("cancel"),
                  }),
                  jsx("button", {
                    type: "button",
                    style: { ...css.btnDanger, opacity: busy ? 0.5 : 1 },
                    disabled: busy,
                    onClick: () => onConfirm(deleteSecret),
                    children: t("delete"),
                  }),
                ],
              }),
            ],
          }),
        ],
      });
    }

    function DiscordSection(props) {
      const t = (props && props.t) || ((k) => DICT.en[k] || k);
      const [items, setItems] = useState([]);
      const [meta, setMeta] = useState({ intents: [] });
      const [err, setErr] = useState("");
      const [loading, setLoading] = useState(true);
      const [mode, setMode] = useState("list");
      const [editing, setEditing] = useState(null);
      const [pendingDelete, setPendingDelete] = useState(null);
      const [deleteBusy, setDeleteBusy] = useState(false);

      const refresh = useCallback(async () => {
        setErr("");
        try {
          const [list, m] = await Promise.all([api("/accounts"), api("/meta")]);
          setItems((list && list.items) || []);
          setMeta(m || { intents: [] });
        } catch (e) {
          setErr((e && e.message) || t("error"));
        } finally {
          setLoading(false);
        }
      }, [t]);

      useEffect(() => {
        void refresh();
      }, [refresh]);

      async function onRemoveToken(account) {
        if (!confirm(t("confirmRemoveToken"))) return;
        try {
          await api("/accounts/" + encodeURIComponent(account.account_id) + "/credential", {
            method: "DELETE",
          });
          await refresh();
        } catch (e) {
          setErr((e && e.message) || t("error"));
        }
      }

      async function confirmDeleteAccount(deleteVaultSecret) {
        if (!pendingDelete) return;
        setDeleteBusy(true);
        try {
          const q = deleteAccountQuery(deleteVaultSecret);
          await api("/accounts/" + encodeURIComponent(pendingDelete.account_id) + q, {
            method: "DELETE",
          });
          setPendingDelete(null);
          await refresh();
        } catch (e) {
          setErr((e && e.message) || t("error"));
        } finally {
          setDeleteBusy(false);
        }
      }

      if (mode === "add" || mode === "edit") {
        return jsx(AccountForm, {
          initial: mode === "edit" ? editing : null,
          meta: meta,
          t: t,
          onCancel: () => {
            setMode("list");
            setEditing(null);
          },
          onSaved: async () => {
            setMode("list");
            setEditing(null);
            await refresh();
          },
        });
      }

      return jsxs("div", {
        className: "dsh-piblox-discord-settings",
        style: css.page,
        children: [
          jsxs("div", {
            style: css.headerBar,
            children: [
              jsxs("div", {
                style: css.headerText,
                children: [
                  jsx("h2", { style: css.title, children: t("title") }),
                  jsx("p", { style: css.subtitle, children: t("subtitle") }),
                ],
              }),
              jsx("button", {
                type: "button",
                style: css.btnAdd,
                onClick: () => setMode("add"),
                children: t("add"),
              }),
            ],
          }),
          loading
            ? jsx("div", { style: css.hint, children: t("loading") })
            : items.length === 0
              ? jsx("div", { style: css.hint, children: t("empty") })
              : jsx("div", {
                  style: { display: "flex", flexDirection: "column", gap: "0.75rem" },
                  children: items.map((item) =>
                    jsx(
                      AccountCard,
                      {
                        item: item,
                        t: t,
                        onEdit: () => {
                          setEditing(item);
                          setMode("edit");
                        },
                        onDelete: () => setPendingDelete(item),
                        onRemoveToken: () => void onRemoveToken(item),
                      },
                      item.account_id,
                    ),
                  ),
                }),
          err ? jsx("p", { role: "alert", style: css.error, children: err }) : null,
          pendingDelete
            ? jsx(
                DeleteAccountDialog,
                {
                  account: pendingDelete,
                  t: t,
                  busy: deleteBusy,
                  onCancel: () => {
                    if (!deleteBusy) setPendingDelete(null);
                  },
                  onConfirm: (deleteVaultSecret) => void confirmDeleteAccount(deleteVaultSecret),
                },
                pendingDelete.account_id,
              )
            : null,
        ],
      });
    }

    function apply(ctx) {
      if (!ctx.slots || !ctx.slots.inject) return;

      ctx.effect(
        () => ctx.locale.register(LOCALE_NS, { en: DICT.en }),
        "dsh-piblox-discord: locale",
      );

      const t = tBound(ctx);
      const injected = () => ({ t });

      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: SECTION_ID,
            order: 16,
            label: () => t("nav"),
            locale: LOCALE_NS,
            inject: injected,
          },
          DiscordSection,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = ["slots", "locale", "settingsScope"];
    exports.DiscordSection = DiscordSection;
    exports.partitionIntents = partitionIntents;
    exports.formatScope = formatScope;
    exports.COMMON_INTENT_IDS = COMMON_INTENT_IDS;
    return module.exports;
  },
});
