/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@uiw/react-md-editor", "@uiw/react-markdown-preview"],
  experimental: {
    serverActions: {
      allowedOrigins: [
        "www.heyrupert.com",
        "heyrupert.com",
        "hey-rupert-portal.vercel.app",
      ],
    },
  },
};

export default nextConfig;
