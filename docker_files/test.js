const fs = require('fs').promises;
const { exec } = require('child_process');
const path = require('path');
const container = 'python3.10'

function preprocessPythonCode(code) {
  let showCount = 0;
  const lines = code.split('\n');
  const processedLines = lines.map(line => {
    if (line.trim().startsWith('plt.show()')) {
      showCount++;
      return line.replace('plt.show()', `plt.savefig('/app/figure_${showCount}.png')`);
    }
    return line;
  });
  return processedLines.join('\n');
}

async function runPythonInDocker(code) {
  const tempFilePath = path.join(__dirname, 'temp_script.py');
  const processedCode = preprocessPythonCode(code);
  console.log(processedCode)
  const generatedFiles = [];

  try {
    // 写入处理后的 Python 代码到临时文件
    await fs.writeFile(tempFilePath, processedCode);

    // 构建 Docker 命令
    const dockerCommand = `docker run --rm -v "${__dirname}:/app" ${container} python /app/temp_script.py`;

    // 执行 Docker 命令
    const result = await new Promise((resolve, reject) => {
      exec(dockerCommand, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        if (stderr) {
          console.error('Docker stderr:', stderr);
        }
        resolve(stdout);
      });
    });

    // 检查生成的图片文件，转换为 base64，然后删除
    for (let i = 1; ; i++) {
        const imagePath = path.join(__dirname, `figure_${i}.png`);
        const imageExists = await fs.access(imagePath).then(() => true).catch(() => false);
        if (imageExists) {
          const imageBuffer = await fs.readFile(imagePath);
          const base64Image = imageBuffer.toString('base64');
          generatedFiles.push({
            filename: `figure_${i}.png`,
            base64: `data:image/png;base64,${base64Image}`
          });
          // 删除临时图片文件
          await fs.unlink(imagePath);
        } else {
          break;
        }
      }

    return {
      output: result.trim(),
      generatedFiles: generatedFiles
    };
  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    // 清理临时文件
    try {
      await fs.unlink(tempFilePath);
    } catch (error) {
      console.error('Error deleting temp file:', error);
    }
  }
}

// 使用示例
async function main() {
  const pythonCode = `
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# 创建一些示例数据
data1 = np.random.randn(1000)
data2 = np.random.randn(1000) + 2

# 绘制第一个直方图
plt.figure(figsize=(10, 6))
plt.hist(data1, bins=30)
plt.title('Histogram of Random Data 1')
plt.xlabel('Value')
plt.ylabel('Frequency')
plt.show()

# 绘制第二个直方图
plt.figure(figsize=(10, 6))
plt.hist(data2, bins=30)
plt.title('Histogram of Random Data 2')
plt.xlabel('Value')
plt.ylabel('Frequency')
plt.show()

# 打印一些基本统计信息
df1 = pd.DataFrame(data1, columns=['value'])
df2 = pd.DataFrame(data2, columns=['value'])
print("Statistics for Data 1:")
print(df1.describe())
print("Statistics for Data 2:")
print(df2.describe())
`;

  try {
    const result = await runPythonInDocker(pythonCode);
    console.log('Python execution result:', result.output);
    result.generatedFiles.forEach(file => {
        console.log(`${file.filename}: ${file.base64.substring(0, 50)}...`);
      });
  } catch (error) {
    console.error('Failed to run Python code in Docker:', error);
  }
}

main();
