import { DeleteOutlined, PlusOutlined, QuestionCircleOutlined, UndoOutlined } from "@ant-design/icons";
import { AutoComplete, Button, Collapse, Form, Input, InputNumber, Popover, Select, Tag, Tooltip } from "antd";
import schemaData from "./schema.generated.json";
import { fieldState, fieldsFor, valueAtPath, type ConfigDocument, type ConfigSchema, type SchemaField, type SchemaNode } from "./document";
import { metadataFor, type FieldMeta } from "./metadata";
import { isSensitive, labelFor } from "./labels";

export const configSchema = schemaData as ConfigSchema;

const suggestions: Record<string, string[]> = {
  logLevel: ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "DISABLED"],
  architecture: ["evm", "svm"],
  type: ["evm", "svm"],
  mode: ["simple", "networks", "verbose"],
  driver: ["memory", "redis", "postgresql", "dynamodb"],
  finality: ["realtime", "unfinalized", "finalized"],
};

type ConfigFieldsProps = {
  overrides?: ConfigDocument;
  defaults?: ConfigDocument;
  onReset?: (path: (string | number)[]) => void;
};

type FieldContext = Required<Pick<ConfigFieldsProps, "overrides" | "defaults">> & Pick<ConfigFieldsProps, "onReset">;

export function ConfigFields({ overrides = {}, defaults = {}, onReset }: ConfigFieldsProps) {
  const context: FieldContext = { overrides, defaults, onReset };
  const rootFields = fieldsFor(configSchema.root, configSchema);
  const basics = rootFields.filter((field) => field.node.kind !== "object" && field.node.kind !== "array" && field.node.kind !== "map" && !metadataFor([field.key], field.node, configSchema).deprecated);
  const sections = rootFields.filter((field) => !basics.includes(field));
  return <>
    <section className="config-basics">
      <h2>基础设置</h2>
      <div className="config-grid">{basics.map((field) => <SchemaField key={field.key} field={field} namePath={[field.key]} schemaPath={[field.key]} statePath={[field.key]} context={context} />)}</div>
    </section>
    <Collapse
      className="config-sections"
      defaultActiveKey={["server", "projects"]}
      items={sections.map((field) => ({
        key: field.key,
        label: <FieldLabel fieldKey={field.key} metaPath={[field.key]} statePath={[field.key]} node={field.node} context={context} />,
        children: <SchemaValue node={field.node} namePath={[field.key]} schemaPath={[field.key]} statePath={[field.key]} context={context} />,
      }))}
    />
  </>;
}

export function ConfigDefinitionFields({
  definition,
  namePath = [],
  schemaPath = [definition],
  overrides = {},
  defaults = {},
  onReset,
}: ConfigFieldsProps & {
  definition: string;
  namePath?: (string | number)[];
  schemaPath?: string[];
}) {
  return <SchemaValue
    node={{ kind: "object", ref: definition }}
    namePath={namePath}
    schemaPath={schemaPath}
    statePath={namePath}
    context={{ overrides, defaults, onReset }}
  />;
}

function SchemaField({ field, namePath, schemaPath, statePath, context }: { field: SchemaField; namePath: (string | number)[]; schemaPath: string[]; statePath: (string | number)[]; context: FieldContext }) {
  return <SchemaValue node={field.node} namePath={namePath} schemaPath={schemaPath} statePath={statePath} fieldKey={field.key} context={context} />;
}

function SchemaValue({ node, namePath, schemaPath, statePath = namePath, fieldKey, context }: { node: SchemaNode; namePath: (string | number)[]; schemaPath: string[]; statePath?: (string | number)[]; fieldKey?: string; context: FieldContext }) {
  if (node.kind === "object") {
    const fields = fieldsFor(node, configSchema);
    return <div className="config-object"><div className="config-grid">{fields.map((field) => {
      const path = [...namePath, field.key];
      const child = <SchemaField key={field.key} field={field} namePath={[...namePath, field.key]} schemaPath={[...schemaPath, field.key]} statePath={[...statePath, field.key]} context={context} />;
      const meta = metadataFor([...schemaPath, field.key], field.node, configSchema);
      if (meta.deprecated) return null;
      if (field.node.kind === "object" || field.node.kind === "array" || field.node.kind === "map") {
        return <details className="config-group" key={field.key}><summary><FieldLabel fieldKey={field.key} metaPath={[...schemaPath, field.key]} statePath={path} node={field.node} context={context} /></summary>{child}</details>;
      }
      return child;
    })}</div></div>;
  }
  if (node.kind === "array") return <ArrayField node={node} namePath={namePath} statePath={statePath} schemaPath={schemaPath} fieldKey={fieldKey || schemaPath.at(-1) || "items"} context={context} />;
  if (node.kind === "map") return <MapField node={node} namePath={namePath} statePath={statePath} schemaPath={schemaPath} fieldKey={fieldKey || schemaPath.at(-1) || "map"} context={context} />;

  const key = fieldKey || schemaPath.at(-1) || "value";
  const label = <FieldLabel fieldKey={key} metaPath={schemaPath} statePath={statePath} node={node} context={context} />;
  if (node.kind === "boolean") {
    return <Form.Item name={namePath} label={label}><Select allowClear placeholder="使用默认值" options={[{ value: true, label: "启用" }, { value: false, label: "关闭" }]} /></Form.Item>;
  }
  if (node.kind === "number") return <Form.Item name={namePath} label={label}><InputNumber className="w-full" /></Form.Item>;
  const options = suggestions[key]?.map((value) => ({ value })) || [];
  return <Form.Item name={namePath} label={label}>
    {isSensitive(schemaPath) ? <Input.Password visibilityToggle autoComplete="off" /> : options.length > 0 ? <AutoComplete options={options} /> : <Input autoComplete="off" />}
  </Form.Item>;
}

function ArrayField({ node, namePath, statePath, schemaPath, fieldKey, context }: { node: SchemaNode; namePath: (string | number)[]; statePath: (string | number)[]; schemaPath: string[]; fieldKey: string; context: FieldContext }) {
  const item = node.item || { kind: "any" as const };
  return <Form.List name={namePath}>{(fields, { add, remove }) => <div className="config-list">
    {fields.map((field, index) => <div className="config-list-item" key={field.key}>
      <div className="config-list-head"><strong>{labelFor(fieldKey)} {index + 1}</strong><Tooltip title="删除"><Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} /></Tooltip></div>
      {/* Form.List supplies the parent prefix through rc-field-form context;
          this child name is intentionally relative to that list. */}
      <SchemaValue node={item} namePath={[field.name]} statePath={[...statePath, field.name]} schemaPath={[...schemaPath, "*"]} fieldKey={fieldKey} context={context} />
    </div>)}
    <Button icon={<PlusOutlined />} onClick={() => add(defaultValue(item))}>添加{labelFor(fieldKey)}</Button>
  </div>}</Form.List>;
}

function MapField({ node, namePath, statePath, schemaPath, fieldKey, context }: { node: SchemaNode; namePath: (string | number)[]; statePath: (string | number)[]; schemaPath: string[]; fieldKey: string; context: FieldContext }) {
  const valueNode = node.value || { kind: "any" as const };
  return <Form.List name={namePath}>{(fields, { add, remove }) => <div className="config-list">
    {fields.map((field) => <div className="config-map-row" key={field.key}>
      {/* As above, list item names are relative; rc-field-form prefixes them. */}
      <Form.Item name={[field.name, "key"]} label="键" rules={[{ required: true, message: "请输入键名" }]}><Input /></Form.Item>
      <div className="config-map-value"><SchemaValue node={valueNode} namePath={[field.name, "value"]} statePath={[...statePath, field.name, "value"]} schemaPath={[...schemaPath, "*"]} fieldKey="value" context={context} /></div>
      <Tooltip title="删除"><Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} /></Tooltip>
    </div>)}
    <Button icon={<PlusOutlined />} onClick={() => add({ key: "", value: defaultValue(valueNode) })}>添加{labelFor(fieldKey)}条目</Button>
  </div>}</Form.List>;
}

function FieldLabel({ fieldKey, metaPath, statePath, node, context }: { fieldKey: string; metaPath: string[]; statePath: (string | number)[]; node: SchemaNode; context: FieldContext }) {
  const meta: FieldMeta = metadataFor(metaPath, node, configSchema);
  const state = fieldState(statePath, context.overrides, context.defaults);
  const canReset = state === "custom" && node.kind !== "object" && node.kind !== "array" && node.kind !== "map";
  const stateLabel = state === "custom" ? "自定义" : state === "system-default" ? "系统默认" : "未设置";
  const defaultValue = valueAtPath(context.defaults, statePath);
  return <span className="config-label"><span>{meta.label}</span><Popover trigger="hover" content={<FieldHelp meta={meta} state={state} defaultValue={defaultValue.exists ? defaultValue.value : undefined} />}><QuestionCircleOutlined className="config-help" /></Popover><Tag className={`config-state config-state-${state}`}>{stateLabel}</Tag>{canReset && context.onReset && <Tooltip title="恢复系统默认"><Button type="text" size="small" icon={<UndoOutlined />} aria-label="恢复系统默认" onClick={(event) => { event.preventDefault(); event.stopPropagation(); context.onReset?.(statePath); }} /></Tooltip>}</span>;
}

function FieldHelp({ meta, state, defaultValue }: { meta: FieldMeta; state: ReturnType<typeof fieldState>; defaultValue?: unknown }) {
  const actualDefault = defaultValue === undefined ? undefined : formatDefault(defaultValue);
  const defaultText = state === "custom" ? "当前使用自定义值" : actualDefault || meta.defaultText || (meta.defaultKind === "runtime" ? "由 eRPC 运行时默认值提供" : meta.defaultKind === "inherited" ? "继承上层配置或 eRPC 默认值" : meta.defaultKind === "deprecated" ? "已弃用，不建议继续使用" : "没有固定默认值，未设置时不启用");
  return <div className="config-help-content"><strong>{meta.description}</strong><div>默认：{defaultText}</div><div>示例：{meta.example}</div><div>原始键：<code>{meta.yamlKey}</code></div><div>{meta.restartRequired ? "修改后需重启 eRPC 生效" : "修改后即时生效"}</div></div>;
}

function formatDefault(value: unknown): string | undefined {
  if (value === null) return "null";
  if (typeof value === "string") return value || "空字符串";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const text = JSON.stringify(value);
    return text && text.length <= 180 ? text : "已配置（展开查看）";
  } catch {
    return undefined;
  }
}

function defaultValue(node: SchemaNode): unknown {
  if (node.kind === "object") return {};
  if (node.kind === "array" || node.kind === "map") return [];
  if (node.kind === "boolean") return undefined;
  return "";
}
