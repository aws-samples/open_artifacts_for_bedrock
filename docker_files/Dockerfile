FROM python:3.10

# Set working directory
WORKDIR /app

RUN apt-get update && apt-get install -y \
    wget \
    bzip2 \
    ca-certificates \
    libglib2.0-0 \
    libxext6 \
    libsm6 \
    libxrender1 \
    git \
    graphviz \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# 更新包列表并安装字体
RUN apt-get update && apt-get install -y \
    fonts-wqy-microhei \
    fonts-wqy-zenhei \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# 使用 Google Noto Fonts（广泛支持多种语言）：
RUN wget https://noto-website-2.storage.googleapis.com/pkgs/NotoSansCJKsc-hinted.zip \
    && unzip NotoSansCJKsc-hinted.zip -d /usr/share/fonts/noto \
    && fc-cache -f -v \
    && rm NotoSansCJKsc-hinted.zip


# Install Python packages using pip
RUN pip install --no-cache-dir numpy pandas scipy scikit-learn matplotlib seaborn jupyter_client diagrams requests bs4 requests

# Set default command
CMD ["python"]