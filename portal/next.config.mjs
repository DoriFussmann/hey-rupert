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
      // The old static Setup pages were replaced by the Setup Turn Engine.
      {
        source: "/portal/preparation/deck-review",
        destination: "/portal/setup/deck-review",
        permanent: false,
      },
      {
        source: "/portal/preparation/messaging-review",
        destination: "/portal/setup/framing",
        permanent: false,
      },
      {
        source: "/portal/preparation/investor-list",
        destination: "/portal/setup/investor-list",
        permanent: false,
      },
      {
        source: "/portal/preparation/:path*",
        destination: "/portal/setup",
        permanent: false,
      },
    ];
  },
  experimental: {
    serverActions: {
      // Investor lists are sent to a server action as JSON.
      bodySizeLimit: "4mb",
      allowedOrigins: [
        "www.heyrupert.com",
        "heyrupert.com",
        "hey-rupert-portal.vercel.app",
      ],
    },
  },
};

export default nextConfig;
