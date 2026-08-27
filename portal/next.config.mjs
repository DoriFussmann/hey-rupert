/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@uiw/react-md-editor", "@uiw/react-markdown-preview"],
  async redirects() {
    return [
      {
        source: "/portal/scope-of-work",
        destination: "/portal/statement-of-work",
        permanent: true,
      },
    ];
  },
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
