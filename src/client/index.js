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

    const SECTION_ID = "discord";
    const LOCALE_NS = "settings.discord";
    const API = "/api/discord";

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
        confirmDelete: "Delete this Discord account config? Bindings/outbox are kept.",
        deleteSecretToo: "Also delete vault secret",
        allowAllGuilds: "Allow all guilds",
        allowAllChannels: "Allow all channels",
        allowAllUsers: "Allow all DM users",
        allowedGuilds: "Allowed guild IDs",
        allowedChannels: "Allowed channel IDs",
        dmEnabled: "Enable DMs",
        dmUsers: "Allowed DM user IDs",
        ignoreBots: "Ignore bot messages",
        intents: "Gateway intents",
        privileged: "privileged",
        status: "Status",
        failClosedHint: "Empty allowlists deny all. Broad access requires the Allow all checkbox.",
        loading: "Loading…",
        error: "Something went wrong",
        snowflakeHint: "One Discord snowflake per line (decimal string)",
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

    function listToLines(list) {
      return (list || []).join("\n");
    }

    const fieldStyle = {
      display: "flex",
      flexDirection: "column",
      gap: "0.25rem",
      fontSize: "0.8rem",
    };
    const inputStyle = {
      padding: "0.45rem 0.6rem",
      borderRadius: "0.4rem",
      border: "1px solid color-mix(in oklab, CanvasText 18%, transparent)",
      background: "transparent",
      color: "inherit",
      font: "inherit",
    };

    function AccountForm({ initial, meta, t, onCancel, onSaved }) {
      const isNew = !initial;
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
        new Set((initial && initial.intents) || (meta.intents || []).filter((i) => i.default).map((i) => i.id)),
      );
      const [busy, setBusy] = useState(false);
      const [err, setErr] = useState("");

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
            allowedGuilds: allowAllGuilds ? [] : linesToList(guilds),
            allowedChannels: allowAllChannels ? [] : linesToList(channels),
            dm: {
              enabled: dmEnabled,
              allowAllUsers,
              allowedUsers: allowAllUsers ? [] : linesToList(dmUsers),
            },
            ignoreBots,
          };
          if (isNew) {
            await api("/accounts", {
              method: "POST",
              body: JSON.stringify({
                account_id: accountId.trim(),
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

      return jsxs("form", {
        onSubmit: onSubmit,
        style: { display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: "40rem" },
        children: [
          jsx("p", { style: { margin: 0, fontSize: "0.85rem", opacity: 0.75 }, children: t("failClosedHint") }),
          isNew
            ? jsxs("label", {
                style: fieldStyle,
                children: [
                  t("accountId"),
                  jsx("input", {
                    required: true,
                    value: accountId,
                    placeholder: t("accountIdHint"),
                    autoComplete: "off",
                    spellCheck: false,
                    onChange: (ev) => setAccountId(ev.target.value),
                    style: inputStyle,
                  }),
                ],
              })
            : jsx("div", {
                style: { fontSize: "0.85rem" },
                children: jsxs("code", { children: [initial.account_id] }),
              }),
          jsxs("label", {
            style: fieldStyle,
            children: [
              t("label"),
              jsx("input", {
                value: label,
                onChange: (ev) => setLabel(ev.target.value),
                style: inputStyle,
              }),
            ],
          }),
          jsxs("label", {
            style: { display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.85rem" },
            children: [
              jsx("input", {
                type: "checkbox",
                checked: enabled,
                onChange: (ev) => setEnabled(ev.target.checked),
              }),
              t("enable"),
            ],
          }),
          isNew
            ? jsxs("label", {
                style: fieldStyle,
                children: [
                  t("token"),
                  jsx("input", {
                    type: "password",
                    value: token,
                    autoComplete: "new-password",
                    onChange: (ev) => setToken(ev.target.value),
                    style: inputStyle,
                  }),
                ],
              })
            : jsxs("div", {
                style: { display: "flex", flexDirection: "column", gap: "0.35rem" },
                children: [
                  jsx("div", {
                    style: { fontSize: "0.85rem" },
                    children:
                      initial.credentials && initial.credentials.configured
                        ? t("tokenConfigured")
                        : t("tokenMissing"),
                  }),
                  !replacing
                    ? jsx("button", {
                        type: "button",
                        onClick: () => setReplacing(true),
                        children: t("replaceToken"),
                      })
                    : jsxs("label", {
                        style: fieldStyle,
                        children: [
                          t("token"),
                          jsx("input", {
                            type: "password",
                            value: token,
                            autoComplete: "new-password",
                            onChange: (ev) => setToken(ev.target.value),
                            style: inputStyle,
                          }),
                        ],
                      }),
                ],
              }),
          jsxs("fieldset", {
            style: { border: "1px solid color-mix(in oklab, CanvasText 18%, transparent)", borderRadius: "0.5rem", padding: "0.75rem" },
            children: [
              jsx("legend", { children: t("intents") }),
              (meta.intents || []).map((intent) =>
                jsxs(
                  "label",
                  {
                    style: { display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.8rem", marginBottom: "0.25rem" },
                    children: [
                      jsx("input", {
                        type: "checkbox",
                        checked: intents.has(intent.id),
                        onChange: () => toggleIntent(intent.id),
                      }),
                      intent.label,
                      intent.privileged
                        ? jsx("span", { style: { opacity: 0.55, fontSize: "0.7rem" }, children: "(" + t("privileged") + ")" })
                        : null,
                    ],
                  },
                  intent.id,
                ),
              ),
            ],
          }),
          jsxs("label", {
            style: { display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.85rem" },
            children: [
              jsx("input", {
                type: "checkbox",
                checked: allowAllGuilds,
                onChange: (ev) => setAllowAllGuilds(ev.target.checked),
              }),
              t("allowAllGuilds"),
            ],
          }),
          !allowAllGuilds
            ? jsxs("label", {
                style: fieldStyle,
                children: [
                  t("allowedGuilds"),
                  jsx("textarea", {
                    value: guilds,
                    placeholder: t("snowflakeHint"),
                    onChange: (ev) => setGuilds(ev.target.value),
                    rows: 3,
                    style: inputStyle,
                  }),
                ],
              })
            : null,
          jsxs("label", {
            style: { display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.85rem" },
            children: [
              jsx("input", {
                type: "checkbox",
                checked: allowAllChannels,
                onChange: (ev) => setAllowAllChannels(ev.target.checked),
              }),
              t("allowAllChannels"),
            ],
          }),
          !allowAllChannels
            ? jsxs("label", {
                style: fieldStyle,
                children: [
                  t("allowedChannels"),
                  jsx("textarea", {
                    value: channels,
                    placeholder: t("snowflakeHint"),
                    onChange: (ev) => setChannels(ev.target.value),
                    rows: 3,
                    style: inputStyle,
                  }),
                ],
              })
            : null,
          jsxs("label", {
            style: { display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.85rem" },
            children: [
              jsx("input", {
                type: "checkbox",
                checked: dmEnabled,
                onChange: (ev) => setDmEnabled(ev.target.checked),
              }),
              t("dmEnabled"),
            ],
          }),
          dmEnabled
            ? jsxs("div", {
                style: { display: "flex", flexDirection: "column", gap: "0.5rem" },
                children: [
                  jsxs("label", {
                    style: { display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.85rem" },
                    children: [
                      jsx("input", {
                        type: "checkbox",
                        checked: allowAllUsers,
                        onChange: (ev) => setAllowAllUsers(ev.target.checked),
                      }),
                      t("allowAllUsers"),
                    ],
                  }),
                  !allowAllUsers
                    ? jsxs("label", {
                        style: fieldStyle,
                        children: [
                          t("dmUsers"),
                          jsx("textarea", {
                            value: dmUsers,
                            placeholder: t("snowflakeHint"),
                            onChange: (ev) => setDmUsers(ev.target.value),
                            rows: 2,
                            style: inputStyle,
                          }),
                        ],
                      })
                    : null,
                ],
              })
            : null,
          jsxs("label", {
            style: { display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.85rem" },
            children: [
              jsx("input", {
                type: "checkbox",
                checked: ignoreBots,
                onChange: (ev) => setIgnoreBots(ev.target.checked),
              }),
              t("ignoreBots"),
            ],
          }),
          jsxs("div", {
            style: { display: "flex", gap: "0.5rem" },
            children: [
              jsx("button", { type: "submit", disabled: busy, children: busy ? t("loading") : t("save") }),
              jsx("button", { type: "button", onClick: onCancel, children: t("cancel") }),
            ],
          }),
          err ? jsx("div", { style: { color: "tomato", fontSize: "0.85rem" }, children: err }) : null,
        ],
      });
    }

    function DiscordSection(props) {
      const t = (props && props.t) || ((k) => DICT.en[k] || k);
      const [items, setItems] = useState([]);
      const [meta, setMeta] = useState({ intents: [] });
      const [err, setErr] = useState("");
      const [loading, setLoading] = useState(true);
      const [mode, setMode] = useState("list"); // list | add | edit
      const [editing, setEditing] = useState(null);
      const [deleteSecret, setDeleteSecret] = useState(false);

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

      async function onDelete(account) {
        if (!confirm(t("confirmDelete"))) return;
        try {
          const q = deleteSecret ? "?deleteSecret=true" : "";
          await api("/accounts/" + encodeURIComponent(account.account_id) + q, { method: "DELETE" });
          setDeleteSecret(false);
          await refresh();
        } catch (e) {
          setErr((e && e.message) || t("error"));
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
        style: { display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: "48rem" },
        children: [
          jsxs("div", {
            children: [
              jsx("h2", {
                style: { margin: 0, fontSize: "1.25rem", letterSpacing: "-0.02em" },
                children: t("title"),
              }),
              jsx("p", {
                style: { opacity: 0.72, margin: "0.25rem 0 0", fontSize: "0.9rem", lineHeight: 1.4 },
                children: t("subtitle"),
              }),
            ],
          }),
          jsx("button", {
            type: "button",
            onClick: () => setMode("add"),
            style: { alignSelf: "flex-start" },
            children: t("add"),
          }),
          loading
            ? jsx("div", { style: { opacity: 0.65 }, children: t("loading") })
            : items.length === 0
              ? jsx("div", { style: { opacity: 0.65 }, children: t("empty") })
              : jsx("div", {
                  style: { display: "flex", flexDirection: "column", gap: "0.65rem" },
                  children: items.map((item) =>
                    jsxs(
                      "div",
                      {
                        style: {
                          padding: "0.75rem",
                          borderRadius: "0.5rem",
                          background: "color-mix(in oklab, Canvas 92%, CanvasText 8%)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.35rem",
                        },
                        children: [
                          jsxs("div", {
                            style: { display: "flex", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" },
                            children: [
                              jsxs("div", {
                                children: [
                                  jsx("strong", { children: item.label || item.account_id }),
                                  jsx("div", {
                                    style: { fontSize: "0.75rem", opacity: 0.7 },
                                    children: item.account_id,
                                  }),
                                ],
                              }),
                              jsx("code", {
                                style: { fontSize: "0.75rem" },
                                children: item.status,
                              }),
                            ],
                          }),
                          jsx("div", {
                            style: { fontSize: "0.8rem", opacity: 0.8 },
                            children:
                              t("token") +
                              ": " +
                              (item.credentials && item.credentials.configured
                                ? t("tokenConfigured")
                                : t("tokenMissing")),
                          }),
                          jsx("div", {
                            style: { fontSize: "0.75rem", opacity: 0.7 },
                            children:
                              "guilds=" +
                              (item.scope_summary && item.scope_summary.guilds) +
                              " channels=" +
                              (item.scope_summary && item.scope_summary.channels) +
                              " dm=" +
                              (item.scope_summary && item.scope_summary.dm),
                          }),
                          jsxs("div", {
                            style: { display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" },
                            children: [
                              jsx("button", {
                                type: "button",
                                onClick: () => {
                                  setEditing(item);
                                  setMode("edit");
                                },
                                children: t("edit"),
                              }),
                              item.credentials && item.credentials.configured
                                ? jsx("button", {
                                    type: "button",
                                    onClick: () => void onRemoveToken(item),
                                    children: t("removeToken"),
                                  })
                                : null,
                              jsxs("label", {
                                style: { display: "flex", gap: "0.3rem", alignItems: "center", fontSize: "0.75rem" },
                                children: [
                                  jsx("input", {
                                    type: "checkbox",
                                    checked: deleteSecret,
                                    onChange: (ev) => setDeleteSecret(ev.target.checked),
                                  }),
                                  t("deleteSecretToo"),
                                ],
                              }),
                              jsx("button", {
                                type: "button",
                                onClick: () => void onDelete(item),
                                children: t("delete"),
                              }),
                            ],
                          }),
                        ],
                      },
                      item.account_id,
                    ),
                  ),
                }),
          err ? jsx("div", { style: { color: "tomato", fontSize: "0.85rem" }, children: err }) : null,
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
    return module.exports;
  },
});
