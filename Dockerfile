FROM ghcr.io/puppeteer/puppeteer:21.6.0

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Update package.json to not skip chromium
RUN sed -i 's/"puppeteer": ".*"/"puppeteer": "^21.6.0"/g' package.json || true

# Install dependencies (puppeteer will download its own Chrome)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
RUN npm install --production

# Copy app source
COPY . .

# Create session directory
RUN mkdir -p /tmp/whatsapp-session && chmod 777 /tmp/whatsapp-session

# Environment
ENV NODE_ENV=production

# Expose port
EXPOSE 8080

# Start
CMD ["node", "index.js"]
