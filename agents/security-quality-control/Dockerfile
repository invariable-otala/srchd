# Dockerfile for agent-computer:security-quality-control
# Provides a secure, isolated environment for security research validation and quality control

FROM ubuntu:24.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install essential packages and development tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Core utilities
    sudo bash coreutils findutils grep sed gawk \
    ca-certificates curl wget git vim nano less fd-find \
    # Process and system tools
    htop tmux screen psmisc procps \
    # Development tools
    build-essential gcc g++ make cmake autoconf automake libtool \
    # Python ecosystem
    python3 python3-pip python3-venv python3-dev \
    # Node.js ecosystem
    nodejs npm \
    # Network tools
    netcat-openbsd iputils-ping dnsutils openssh-client nmap tcpdump wireshark-common tshark \
    # Archive tools
    zip unzip tar gzip bzip2 xz-utils \
    # Text processing
    jq xmlstarlet \
    # Search Tools
    ripgrep \
    # RE tools - debugging and tracing
    gdb gdb-multiarch lldb ltrace strace valgrind \
    # RE tools - binary analysis
    file binutils binwalk upx-ucl objdump readelf \
    # RE tools - hex inspection
    xxd hexdump \
    # RE tools - fuzzing
    afl++ libfuzzer-14-dev \
    # Qemu for emulation
    qemu-system qemu-user qemu-user-static \
    # Java runtime for Ghidra
    openjdk-21-jdk-headless \
    # Font libraries required by Ghidra headless analyzer
    libharfbuzz0b libfreetype6 fontconfig \
    # Additional dependencies for RE tools
    libcapstone-dev libkeystone-dev libunicorn-dev \
    # Perl for some security tools
    perl libwww-perl \
    # Ruby for some security tools
    ruby ruby-dev \
    # Cryptography libraries
    libssl-dev \
    # Testing frameworks
    python3-pytest \
    # Documentation tools
    pandoc \
    # Diff and comparison utilities
    diffutils colordiff meld \
    # Security validation tools
    checksec.sh \
    && rm -rf /var/lib/apt/lists/*

# Install x86 multilib packages (only available on amd64)
RUN if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
        apt-get update && apt-get install -y --no-install-recommends \
        gcc-multilib g++-multilib libc6-dev-i386 \
        && rm -rf /var/lib/apt/lists/*; \
    fi

# Install radare2 from source (latest version)
RUN git clone --depth 1 https://github.com/radareorg/radare2 /opt/radare2 && \
    cd /opt/radare2 && sys/install.sh

# Install Ghidra (headless)
RUN mkdir -p /opt/ghidra && \
    curl -L -o /tmp/ghidra.zip "https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_11.2.1_build/ghidra_11.2.1_PUBLIC_20241105.zip" && \
    unzip /tmp/ghidra.zip -d /opt/ghidra && \
    rm /tmp/ghidra.zip && \
    ln -s /opt/ghidra/ghidra_11.2.1_PUBLIC /opt/ghidra/latest && \
    ln -s /opt/ghidra/latest/support/analyzeHeadless /usr/local/bin/analyzeHeadless

# Install honggfuzz from source
RUN git clone --depth 1 https://github.com/google/honggfuzz /opt/honggfuzz && \
    cd /opt/honggfuzz && make && make install

# Install seccomp-tools for validation
RUN gem install seccomp-tools

# Create non-root user 'agent' with uid 1001
RUN groupadd -g 1001 agent && \
    useradd -u 1001 -g 1001 -m -s /bin/bash agent && \
    # Give agent sudo access (for permissive mode)
    echo 'agent ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

RUN mkdir -p /home/agent/.ssh && \
    chown -R agent:agent /home/agent/.ssh && \
    chmod 700 /home/agent/.ssh

USER agent
# IDENTITY_FILES_COPY_PLACEHOLDER
WORKDIR /home/agent

RUN ssh-keyscan github.com >> /home/agent/.ssh/known_hosts

# Create Python virtual environment and install RE packages
RUN python3 -m venv /home/agent/.venv && \
    /home/agent/.venv/bin/pip install --upgrade pip && \
    /home/agent/.venv/bin/pip install \
    # Data science and analysis
    numpy pandas matplotlib \
    # Web and API tools
    requests httpx beautifulsoup4 \
    # RE Python tools - core
    r2pipe \
    frida-tools frida \
    pwntools \
    # RE Python tools - disassembly/assembly
    capstone \
    keystone-engine \
    # RE Python tools - emulation
    unicorn \
    # RE Python tools - symbolic execution
    angr \
    # RE Python tools - binary parsing
    pyelftools \
    lief \
    # RE Python tools - crypto
    pycryptodome \
    # RE Python tools - fuzzing
    boofuzz \
    # Utilities
    ropper \
    ropgadget \
    # Network protocol tools
    scapy \
    impacket \
    # Additional security tools
    z3-solver \
    # Testing frameworks
    pytest pytest-timeout \
    # Code analysis
    pylint bandit \
    # Validation utilities
    checksumdir

# Configure shell environment
RUN echo 'export PATH="/home/agent/.venv/bin:/opt/ghidra/latest/support:/usr/local/bin:$PATH"' >> /home/agent/.profile && \
    echo 'export PYTHONPATH="/home/agent:$PYTHONPATH"' >> /home/agent/.profile && \
    echo 'export GHIDRA_INSTALL_DIR="/opt/ghidra/latest"' >> /home/agent/.profile && \
    echo 'export PATH="/home/agent/.venv/bin:/opt/ghidra/latest/support:/usr/local/bin:$PATH"' >> /home/agent/.bashrc && \
    echo 'export PYTHONPATH="/home/agent:$PYTHONPATH"' >> /home/agent/.bashrc && \
    echo 'export GHIDRA_INSTALL_DIR="/opt/ghidra/latest"' >> /home/agent/.bashrc && \
    echo 'alias ll="ls -la"' >> /home/agent/.bashrc && \
    echo 'alias la="ls -la"' >> /home/agent/.bashrc && \
    echo 'alias r2="radare2"' >> /home/agent/.bashrc && \
    echo 'cd /home/agent' >> /home/agent/.bashrc

# Create directory for GDB command files and configure GDB
RUN mkdir -p /home/agent/.gdb && \
    echo 'set disassembly-flavor intel' >> /home/agent/.gdbinit && \
    echo 'set pagination off' >> /home/agent/.gdbinit && \
    echo 'set follow-fork-mode child' >> /home/agent/.gdbinit

# Create directories for validation logs and reproduction environments
RUN mkdir -p /home/agent/validation-logs /home/agent/reproduction-envs

# Default command
CMD ["/bin/bash"]

# Metadata
LABEL maintainer="agent-computer" \
      description="Secure sandbox environment for security research validation and quality control" \
      version="1.0"
