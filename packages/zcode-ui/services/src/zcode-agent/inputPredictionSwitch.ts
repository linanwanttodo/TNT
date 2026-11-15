/** 环境变量名：未设置或为空时取缺省（开启）；"1" 开启；"0" 或其它任何值关闭。 */
export const REMOTE_INPUT_PREDICTION_ENV = "ZCODE_REMOTE_INPUT_PREDICTION";

/**
 * 未设置环境变量时的缺省：关闭。本地 Web UI 不提供远控输入预测能力。
 */
export const REMOTE_INPUT_PREDICTION_DEFAULT_ENABLED = false;

export function isRemoteInputPredictionEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return false;
}
