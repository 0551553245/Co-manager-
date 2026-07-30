/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Default Server Action body limit is 1MB — too small for a real
    // camera photo (task/food-safety evidence uploads via
    // lib/cloudinary/upload-photo.ts).
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
