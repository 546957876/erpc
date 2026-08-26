import { DeleteOutlined, PlusOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import { Alert, AutoComplete, Button, Form, Input, InputNumber, Segmented, Select, Tooltip } from "antd";
import { ConfigDefinitionFields } from "../config/ConfigFields";
import { providerDefinition, providerOptions, type NetworkMode, type ProviderSettingField } from "../config/providers";

type ProviderFormFieldsProps = {
  vendor: string;
  networkMode: NetworkMode;
  showVendorSelector: boolean;
  allowCustomVendor: boolean;
  customProviderAccessMode: string;
  onVendorSelected: (vendor: string) => void | Promise<void>;
};

export function ProviderFormFields({ vendor, networkMode, showVendorSelector, allowCustomVendor, customProviderAccessMode, onVendorSelected }: ProviderFormFieldsProps) {
  const definition = providerDefinition(vendor);
  const knownOptions = providerOptions();
  const vendorOptions = !vendor || knownOptions.some((option) => option.value === vendor)
    ? knownOptions
    : [{ value: vendor, label: `现有未收录厂商：${vendor}` }, ...knownOptions];

  return <>
    {showVendorSelector && <Form.Item
      name="vendor"
      label={<HelpLabel title={allowCustomVendor ? "厂商代码" : "更换 eRPC 厂商"} help={allowCustomVendor ? "填写当前 eRPC 已支持、但本页面尚未收录的厂商代码；保存前仍会由 eRPC 校验。" : "选择 eRPC 已支持的厂商。切换后会清空旧厂商的密钥和专用参数。"} />}
      extra={allowCustomVendor ? "通常从上方下拉选择；仅在 eRPC 新增厂商尚未更新本页面时填写此项。" : undefined}
      rules={[{ required: true, whitespace: true, message: "请输入或选择 RPC 厂商" }]}
    >
      {allowCustomVendor
        ? <AutoComplete options={knownOptions} onSelect={(value) => void onVendorSelected(String(value))} onBlur={(event) => void onVendorSelected((event.target as HTMLInputElement).value)} placeholder="输入厂商代码，例如 future-provider" filterOption={(input, option) => String(option?.label || option?.value || "").toLowerCase().includes(input.toLowerCase())} />
        : <Select showSearch optionFilterProp="label" options={[...vendorOptions, { value: customProviderAccessMode, label: "其他 / 未收录 eRPC 厂商" }]} onChange={(value) => void onVendorSelected(String(value))} placeholder="选择 eRPC 厂商" />}
    </Form.Item>}

    {definition.fields.length === 0
      ? <Alert type="info" showIcon message="这是未收录的厂商" description="请在“扩展厂商参数”中按该厂商要求填写参数。eRPC 的最终配置校验仍会在保存前执行。" />
      : <div className="provider-fields">{definition.fields.map((field) => <ProviderSetting key={field.key} field={field} vendorLabel={definition.label} />)}</div>}

    {definition.refreshDefault && <Alert
      className="provider-note"
      type="info"
      showIcon
      message={`网络目录默认每 ${definition.refreshDefault} 刷新一次`}
      description="该周期由 eRPC 厂商实现提供，目前不是 erpc.yaml 的可编辑字段，因此这里按源码默认值显示。"
    />}

    <Form.List name="extraSettings">{(fields, { add, remove }) => <section className="provider-section">
      <div className="provider-section-heading"><div><strong>其他厂商参数</strong><p>用于 eRPC 后续新增、私有或尚未收录的参数，参数名不会被前端限制。</p></div></div>
      {fields.map((field) => <div className="provider-extra-row" key={field.key}>
        <Form.Item name={[field.name, "key"]} label="参数名" rules={[{ required: true, whitespace: true, message: "请输入参数名" }]}><Input placeholder="例如 futureOption" /></Form.Item>
        <Form.Item name={[field.name, "type"]} label="数据类型" rules={[{ required: true }]}><Select options={[
          { value: "string", label: "文本" },
          { value: "number", label: "数字" },
          { value: "boolean", label: "布尔值" },
          { value: "json", label: "JSON" },
        ]} /></Form.Item>
        <Form.Item name={[field.name, "value"]} label="参数值" rules={[{ required: true, message: "请输入参数值" }]}><Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} /></Form.Item>
        <Tooltip title="删除扩展参数"><Button className="provider-row-delete" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} /></Tooltip>
      </div>)}
      <Button icon={<PlusOutlined />} onClick={() => add({ key: "", type: "string", value: "" })}>添加扩展参数</Button>
    </section>}</Form.List>

    <section className="provider-section">
      <Form.Item
        name="networkMode"
        label={<HelpLabel title="适用网络" help="全部网络会让厂商自行发现；仅指定网络只生成列表中的网络；排除网络会跳过列表中的网络。网络格式例如 evm:1、evm:56。" />}
        rules={[{ required: true }]}
      >
        <Segmented block options={[
          { value: "all", label: "全部网络" },
          { value: "only", label: "仅指定网络" },
          { value: "ignore", label: "排除网络" },
        ]} />
      </Form.Item>
      {networkMode !== "all" && <Form.Item
        name="networks"
        label={networkMode === "only" ? "指定网络" : "排除网络"}
        extra="输入后按回车，可添加多个网络；例如 evm:1、evm:56。"
        rules={[{ required: true, message: "请至少填写一个网络标识" }]}
      ><Select mode="tags" tokenSeparators={[",", "，"]} open={false} placeholder="例如 evm:1" /></Form.Item>}
    </section>

    <Form.Item
      name="upstreamIdTemplate"
      label={<HelpLabel title="自动生成的节点名称格式" help="eRPC 会把 <PROVIDER> 替换为上面的厂商实例名称，把 <NETWORK> 替换为网络标识。还可使用 <VENDOR>（厂商代码）和 <EVM_CHAIN_ID>（数字链 ID）。" />}
      extra="通常无需修改。默认值 <PROVIDER>-<NETWORK>：名称 alchemy-main、网络 evm:56 会生成 alchemy-main-evm:56。"
      rules={[{ required: true, whitespace: true, message: "请输入生成节点名称模板" }]}
    ><Input placeholder="<PROVIDER>-<NETWORK>" /></Form.Item>

    <Form.List name="overrides">{(fields, { add, remove }) => <section className="provider-section">
      <div className="provider-section-heading"><div><strong>生成节点覆盖配置</strong><p>按匹配规则覆盖厂商生成节点的完整上游配置；不填写时使用 eRPC 默认配置。</p></div></div>
      {fields.map((field, index) => <details className="provider-override" key={field.key} open={index === 0}>
        <summary><span>覆盖规则 {index + 1}</span><Tooltip title="删除覆盖规则"><Button type="text" danger icon={<DeleteOutlined />} onClick={(event) => { event.preventDefault(); remove(field.name); }} /></Tooltip></summary>
        <Form.Item name={[field.name, "raw"]} hidden><StoredObject /></Form.Item>
        <Form.Item name={[field.name, "key"]} label="匹配规则" extra="例如 *、evm:* 或 evm:1" rules={[{ required: true, whitespace: true, message: "请输入覆盖匹配规则" }]}><Input /></Form.Item>
        <ConfigDefinitionFields definition="UpstreamConfig" namePath={[field.name, "value"]} schemaPath={["ProviderConfig", "overrides", "*"]} />
      </details>)}
      <Button icon={<PlusOutlined />} onClick={() => add({ key: "*", value: {}, raw: {} })}>添加覆盖规则</Button>
    </section>}</Form.List>
  </>;
}

function ProviderSetting({ field, vendorLabel }: { field: ProviderSettingField; vendorLabel: string }) {
  const label = <HelpLabel title={field.label} help={`${vendorLabel} 的“${field.label}”参数。默认：${field.defaultText || "不设置"}；示例：${field.example}。`} />;
  const rules = field.required ? [{ required: true, message: `请输入${field.label}` }] : undefined;
  if (field.kind === "secret") return <Form.Item name={["settings", field.key]} label={label} rules={rules}><Input.Password visibilityToggle autoComplete="off" placeholder={field.example} /></Form.Item>;
  if (field.kind === "tags" || field.kind === "number-tags") return <Form.Item name={["settings", field.key]} label={label} rules={rules}><Select mode="tags" tokenSeparators={[",", "，"]} open={false} placeholder={field.example} /></Form.Item>;
  if (field.kind === "credit-units") return <Form.List name={["settings", field.key]}>{(fields, { add, remove }) => <div className="credit-units-field">
    <div className="provider-section-heading"><div><strong>{label}</strong><p>为特定 JSON-RPC 方法覆盖厂商积分消耗。</p></div></div>
    {fields.map((item) => <div className="credit-unit-row" key={item.key}>
      <Form.Item name={[item.name, "method"]} label="RPC 方法" rules={[{ required: true, whitespace: true, message: "请输入 RPC 方法" }]}><Input placeholder="例如 eth_call" /></Form.Item>
      <Form.Item name={[item.name, "units"]} label="积分" rules={[{ required: true, message: "请输入积分" }]}><InputNumber min={0} precision={0} className="w-full" /></Form.Item>
      <Tooltip title="删除方法积分"><Button className="provider-row-delete" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(item.name)} /></Tooltip>
    </div>)}
    <Button icon={<PlusOutlined />} onClick={() => add({ method: "", units: 1 })}>添加方法积分</Button>
  </div>}</Form.List>;
  return <Form.Item name={["settings", field.key]} label={label} rules={rules}><Input autoComplete="off" placeholder={field.example} /></Form.Item>;
}

function HelpLabel({ title, help }: { title: string; help: string }) {
  return <span className="provider-field-label"><span>{title}</span><Tooltip title={help}><QuestionCircleOutlined /></Tooltip></span>;
}

function StoredObject(_props: { value?: Record<string, unknown>; onChange?: (value: Record<string, unknown>) => void }) {
  return null;
}
