// gen-cloud-vdb.cpp — procedural cumulus-style fog grid for NanoVDB export
#include <openvdb/openvdb.h>
#include <openvdb/tools/LevelSetSphere.h>
#include <cmath>
#include <iostream>

static float hash31(float x, float y, float z) {
    float p = x * 127.1f + y * 311.7f + z * 74.7f;
    p = std::sin(p) * 43758.5453f;
    return p - std::floor(p);
}

static float noise3(float x, float y, float z) {
    const int ix = static_cast<int>(std::floor(x));
    const int iy = static_cast<int>(std::floor(y));
    const int iz = static_cast<int>(std::floor(z));
    const float fx = x - ix;
    const float fy = y - iy;
    const float fz = z - iz;
    const float ux = fx * fx * (3.f - 2.f * fx);
    const float uy = fy * fy * (3.f - 2.f * fy);
    const float uz = fz * fz * (3.f - 2.f * fz);
    const float c000 = hash31(ix, iy, iz);
    const float c100 = hash31(ix + 1, iy, iz);
    const float c010 = hash31(ix, iy + 1, iz);
    const float c110 = hash31(ix + 1, iy + 1, iz);
    const float c001 = hash31(ix, iy, iz + 1);
    const float c101 = hash31(ix + 1, iy, iz + 1);
    const float c011 = hash31(ix, iy + 1, iz + 1);
    const float c111 = hash31(ix + 1, iy + 1, iz + 1);
    const float x00 = c000 + (c100 - c000) * ux;
    const float x10 = c010 + (c110 - c010) * ux;
    const float x01 = c001 + (c101 - c001) * ux;
    const float x11 = c011 + (c111 - c011) * ux;
    const float y0 = x00 + (x10 - x00) * uy;
    const float y1 = x01 + (x11 - x01) * uy;
    return y0 + (y1 - y0) * uz;
}

static float fbm(float x, float y, float z, int octaves) {
    float amp = 0.55f;
    float freq = 1.f;
    float sum = 0.f;
    float norm = 0.f;
    for (int i = 0; i < octaves; ++i) {
        sum += noise3(x * freq, y * freq, z * freq) * amp;
        norm += amp;
        amp *= 0.5f;
        freq *= 2.03f;
    }
    return sum / norm;
}

int main(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "usage: gen-cloud-vdb <out.vdb>\n";
        return 1;
    }
    openvdb::initialize();
    auto grid = openvdb::FloatGrid::create(0.f);
    grid->setTransform(openvdb::math::Transform::createLinearTransform(0.22));
    grid->setGridClass(openvdb::GRID_FOG_VOLUME);
    grid->setName("density");

    auto acc = grid->getAccessor();
    const int half = 40;
    const openvdb::Vec3f center(0.f, 6.f, 0.f);
    const float radius = 18.f;

    for (int iz = -half; iz <= half; ++iz) {
        for (int iy = -half; iy <= half; ++iy) {
            for (int ix = -half; ix <= half; ++ix) {
                const openvdb::Vec3f p(static_cast<float>(ix), static_cast<float>(iy), static_cast<float>(iz));
                const float dist = (p - center).length();
                if (dist > radius + 6.f) continue;
                const float shell = std::max(0.f, 1.f - dist / (radius + 2.f));
                const float n = fbm(ix * 0.11f + 4.f, iy * 0.09f + 1.f, iz * 0.11f + 9.f, 5);
                const float wispy = std::pow(std::max(0.f, n - 0.38f), 1.35f);
                float density = shell * wispy * 2.2f;
                if (density < 0.02f) continue;
                density = std::min(density, 1.f);
                acc.setValue(openvdb::Coord(ix, iy, iz), density);
            }
        }
    }

    openvdb::io::File file(argv[1]);
    openvdb::GridPtrVec grids;
    grids.push_back(grid);
    file.write(grids);
    file.close();
    std::cout << "wrote " << argv[1] << '\n';
    return 0;
}