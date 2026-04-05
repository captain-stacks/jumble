/**
 * Executes JavaScript code in a sandboxed context
 * Returns the result of the last expression or console output
 */
export async function executeCode(
  code: string,
  onLog?: (log: string) => void
): Promise<{
  success: boolean
  result?: unknown
  error?: string
  output: string[]
}> {
  const output: string[] = []

  const addOutput = (message: string) => {
    output.push(message)
    if (onLog) {
      onLog(message)
    }
  }

  // Create a proxy for console
  const consoleProxy = {
    log: (...args: unknown[]) => {
      const message = args.map((arg) => String(arg)).join(' ')
      addOutput(message)
    },
    error: (...args: unknown[]) => {
      const message = 'ERROR: ' + args.map((arg) => String(arg)).join(' ')
      addOutput(message)
    },
    warn: (...args: unknown[]) => {
      const message = 'WARN: ' + args.map((arg) => String(arg)).join(' ')
      addOutput(message)
    },
    info: (...args: unknown[]) => {
      const message = 'INFO: ' + args.map((arg) => String(arg)).join(' ')
      addOutput(message)
    },
  }

  try {
    // Create function with limited global scope
    const fn = new Function('console', `return (async () => { ${code} })()`)
    const result = await fn(consoleProxy)

    return {
      success: true,
      result,
      output,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      error: errorMessage,
      output,
    }
  }
}

/**
 * Formats execution result for display
 */
export function formatExecutionResult(result: {
  success: boolean
  result?: unknown
  error?: string
  output: string[]
}): string {
  let formatted = ''

  if (result.output.length > 0) {
    formatted += 'Output:\n' + result.output.join('\n')
  }

  if (result.success && result.result !== undefined) {
    if (formatted) formatted += '\n\n'
    formatted += 'Result: ' + JSON.stringify(result.result, null, 2)
  }

  if (result.error) {
    if (formatted) formatted += '\n\n'
    formatted += 'Error: ' + result.error
  }

  return formatted || 'Code executed successfully (no output)'
}
