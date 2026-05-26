FROM docker/sandbox-templates:codex

USER root
COPY shared/install-codeagent.sh /tmp/install-codeagent.sh
RUN chmod +x /tmp/install-codeagent.sh && /tmp/install-codeagent.sh

USER agent
RUN npm install -g @codeagent-ui/codeagent && codeagent --version

COPY --chown=agent:agent shared/start-codeagent.sh /home/agent/.codeagent-start.sh
RUN echo '. ~/.codeagent-start.sh' >> /home/agent/.bashrc
